import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('./fetch-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fetch-utils')>();
  return { ...actual, fetchUpstream: vi.fn() };
});

import { fetchUpstream } from './fetch-utils';
import { fetchDoubanRecommend, fetchDoubanSuggest } from './douban';

const fetchMock = fetchUpstream as unknown as Mock;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchDoubanSuggest 缓存策略', () => {
  it('请求失败返回空列表但不缓存，下次请求会重试', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchDoubanSuggest('流浪')).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: '35267208', title: '流浪地球2', img: '', year: '2023' }])
    );
    const items = await fetchDoubanSuggest('流浪');
    expect(items.map((i) => i.title)).toEqual(['流浪地球2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('空结果只做 30s 短缓存', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchDoubanSuggest('不存在的片名');
    await fetchDoubanSuggest('不存在的片名');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    await fetchDoubanSuggest('不存在的片名');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('成功结果缓存 10 分钟', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: '1', title: '三体', img: '', episode: '30' }])
    );
    expect(await fetchDoubanSuggest('三体')).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    expect(await fetchDoubanSuggest('三体')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    await fetchDoubanSuggest('三体');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchDoubanRecommend 缓存策略', () => {
  it('空推荐只做短缓存，源恢复后能尽快取到数据', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ subjects: [] }));
    expect(await fetchDoubanRecommend('movie', '热门', 0, 3)).toEqual([]);

    vi.advanceTimersByTime(31_000);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ subjects: [{ id: '1', title: '黑球', cover: '', rate: '8.6' }] })
    );
    const items = await fetchDoubanRecommend('movie', '热门', 0, 3);
    expect(items.map((i) => i.title)).toEqual(['黑球']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
