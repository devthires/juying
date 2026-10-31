import type { DoubanItem } from './types';
import { fetchUpstream, getCache, setCache } from './fetch-utils';

/**
 * 豆瓣推荐数据获取（服务端直连，带内存缓存与降级链）。
 * 旧版在浏览器里经公共 CORS 代理请求豆瓣（隐私差且不稳定），
 * 重构后由服务端直连，仅在直连被拒时降级到公共代理。
 */

const DOUBAN_API = 'https://movie.douban.com/j/search_subjects';
const CACHE_TTL = 10 * 60 * 1000;
/** 空结果短缓存：豆瓣偶发限流会返回空列表，按正常 TTL 缓存会让推荐/联想长时间空白 */
const EMPTY_CACHE_TTL = 30 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

interface DoubanRawSubject {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url?: string;
}

function fallbackProxies(): string[] {
  const proxies: string[] = [];
  if (process.env.FALLBACK_CORS_PROXY) proxies.push(process.env.FALLBACK_CORS_PROXY);
  return proxies;
}

export async function fetchDoubanRecommend(
  type: 'movie' | 'tv',
  tag: string,
  pageStart: number,
  pageSize: number
): Promise<DoubanItem[]> {
  const cacheKey = `douban:${type}:${tag}:${pageStart}:${pageSize}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const target = `${DOUBAN_API}?type=${type}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  let raw: DoubanRawSubject[] | undefined;

  // 1) 服务端直连
  try {
    const res = await fetchUpstream(target, {
      timeoutMs: 8000,
      headers: { 'User-Agent': UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as { subjects?: DoubanRawSubject[] };
      raw = data.subjects;
    }
  } catch {
    // 忽略，走降级
  }

  // 2) 降级：经 FALLBACK_CORS_PROXY
  if (!raw) {
    for (const proxy of fallbackProxies()) {
      try {
        const res = await fetchUpstream(proxy + encodeURIComponent(target), {
          timeoutMs: 8000,
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = (await res.json()) as { subjects?: DoubanRawSubject[] };
          raw = data.subjects;
          if (raw) break;
        }
      } catch {
        // 继续尝试下一个
      }
    }
  }

  if (!raw) throw new Error('豆瓣推荐获取失败');

  const items: DoubanItem[] = raw.map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    rating: s.rate && s.rate !== '0' ? s.rate : undefined,
    isTv: type === 'tv',
  }));

  setCache(cacheKey, items, items.length > 0 ? CACHE_TTL : EMPTY_CACHE_TTL);
  return items;
}

/**
 * 搜索框联想：用豆瓣自家搜索框的 subject_suggest 接口（movie.douban.com/j/subject_suggest）。
 * 输入即返回片名匹配候选（海报 + 年份 + 电影/剧集类型），返回序即豆瓣热度序，
 * 正好满足「输入时下拉出模糊匹配的影片、热度高的在前」。
 * 注意不能用 search_subjects 的 tag 传关键词：那会被当成分类标签推荐（实测返回无关影片）。
 */
interface DoubanRawSuggest {
  id: string;
  title: string;
  img: string;
  /** 集数：有值即为剧集。实测 type 字段对剧集也常标 movie，不可信 */
  episode?: string;
  year?: string;
}

export async function fetchDoubanSuggest(wd: string): Promise<DoubanItem[]> {
  const keyword = wd.trim().slice(0, 50);
  if (!keyword) return [];

  const cacheKey = `douban:suggest:${keyword}`;
  const cached = getCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  let raw: DoubanRawSuggest[] | undefined;
  try {
    const res = await fetchUpstream(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`,
      {
        timeoutMs: 6000,
        headers: { 'User-Agent': UA, Referer: 'https://movie.douban.com/', Accept: 'application/json' },
      }
    );
    if (res.ok) raw = (await res.json()) as DoubanRawSuggest[];
  } catch {
    // 联想是增强功能，失败静默降级为空列表
  }
  // 请求失败不缓存：否则一次网络抖动会让该关键词在整个 TTL 内一直无联想
  if (!raw) return [];

  const seen = new Set<string>();
  const items = raw
    .filter((s) => {
      if (!s.title || !s.id || seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    })
    .map((s) => ({
      id: s.id,
      title: s.title,
      cover: s.img,
      isTv: Boolean(s.episode),
      year: s.year || undefined,
    }));

  setCache(cacheKey, items, items.length > 0 ? CACHE_TTL : EMPTY_CACHE_TTL);
  return items;
}
