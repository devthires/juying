import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchDoubanSuggest } from '@/lib/douban';

export const runtime = 'nodejs';

/**
 * 搜索框联想：输入关键词返回豆瓣热度序的影片候选（电影+剧集，含封面与评分）。
 * 联想属于增强功能：豆瓣不可达时返回空列表，前端静默隐藏该区块即可，不弹错误。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 50);
  if (!q) return NextResponse.json({ items: [] });

  try {
    const items = await fetchDoubanSuggest(q);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
