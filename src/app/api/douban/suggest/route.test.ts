import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

/**
 * 联想接口单测：subject_suggest 字段映射（海报/年份/类型）、标题去重，
 * 以及上游失败时的静默降级（返回空列表而非 5xx）。
 * 上游拉取一律 mock，不产生网络请求。
 */

const state = vi.hoisted(() => ({
  /** 上游返回的候选数组；undefined 模拟网络失败 */
  upstream: [] as { id: string; title: string; img: string; episode?: string; year?: string }[] | undefined,
}));

vi.mock('@/lib/fetch-utils', () => ({
  fetchUpstream: vi.fn(async () => {
    if (!state.upstream) throw new Error('network down');
    return new Response(JSON.stringify(state.upstream), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }),
  // 联想不走内存缓存读路径（getCache 恒未命中），保证每次用例都打到 mock 的上游
  getCache: vi.fn(() => undefined),
  setCache: vi.fn(),
}));

interface SuggestPayload {
  items?: { title: string; cover: string; year?: string; isTv?: boolean }[];
  error?: string;
}

function makeRequest(q: string): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/douban/suggest?q=${encodeURIComponent(q)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

beforeAll(() => {
  process.env.PASSWORD = 'test-password';
});

describe('GET /api/douban/suggest', () => {
  it('空关键词返回空列表', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuggestPayload).items).toEqual([]);
  });

  it('映射候选字段：海报取 img、年份透传、有集数标记剧集、同名去重', async () => {
    state.upstream = [
      { id: '35267208', title: '流浪地球2', img: 'https://img/m1.jpg', year: '2023' },
      { id: '999', title: '流浪地球2', img: 'https://img/dup.jpg', year: '2023' },
      { id: '25853071', title: '庆余年 第一季', img: 'https://img/t1.jpg', episode: '46', year: '2019' },
    ];
    const res = await GET(makeRequest('流浪'));
    const { items } = (await res.json()) as SuggestPayload;
    expect(items?.map((i) => i.title)).toEqual(['流浪地球2', '庆余年 第一季']);
    expect(items?.[0]).toMatchObject({ cover: 'https://img/m1.jpg', year: '2023', isTv: false });
    expect(items?.[1].isTv).toBe(true);
  });

  it('上游不可达时静默返回空列表（联想是增强功能，不弹错误）', async () => {
    state.upstream = undefined;
    const res = await GET(makeRequest('任意词'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as SuggestPayload).items).toEqual([]);
  });
});
