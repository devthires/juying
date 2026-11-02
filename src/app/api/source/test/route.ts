import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { fetchUpstream } from '@/lib/fetch-utils';
import { parseSearchList } from '@/lib/cms-parser';

export const runtime = 'nodejs';

/** 点播源探活：以搜索 "test" 的响应耗时与结果量衡量可用性 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let url = '';
  try {
    const body = (await req.json()) as { url?: string };
    url = (body.url || '').trim().replace(/\/+$/, '');
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }

  const verdict = await checkUpstreamAllowed(url);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, ms: 0, error: verdict.reason });
  }

  const start = Date.now();
  try {
    const res = await fetchUpstream(`${url}?ac=videolist&wd=test`, {
      timeoutMs: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36', Accept: 'application/json' },
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      return NextResponse.json({ ok: false, ms, error: `HTTP ${res.status}` });
    }
    const data = await res.json();
    // 先识别 TVBox 配置：这类 JSON 有 sites/lives/spider，不是点播接口。
    // 之前直接 parseSearchList 会得到空数组并返回 ok，造成「绿色但永远搜不到」。
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.sites) || Array.isArray(record.lives) || typeof record.spider === 'string') {
        return NextResponse.json({ ok: false, ms, error: 'TVBox 配置，请走数据源订阅' });
      }
      // 苹果 CMS 的搜索响应应有 list 字段；没有 list 说明不是点播接口
      if (!Object.prototype.hasOwnProperty.call(record, 'list')) {
        return NextResponse.json({ ok: false, ms, error: '不是苹果CMS接口（缺少 list）' });
      }
    }
    const list = parseSearchList(data, { key: 'test', name: 'test', url });
    return NextResponse.json({ ok: true, ms, count: list.length });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '超时' : err.message) : '请求失败',
    });
  }
}
