import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DETAIL_PAYLOAD,
  LIVE_M3U,
  SEARCH_LIST,
  SOURCE,
  authCookie,
  getRequest,
  jsonRequest,
  jsonResponse,
} from './helpers';

const { fetchUpstreamMock } = vi.hoisted(() => ({ fetchUpstreamMock: vi.fn() }));

vi.mock('@/lib/fetch-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fetch-utils')>();
  return { ...actual, fetchUpstream: fetchUpstreamMock };
});

vi.mock('@/lib/ssrf', () => ({
  checkUpstreamAllowed: vi.fn(async () => ({ ok: true })),
  checkLiveUrlAllowed: vi.fn(async () => ({ ok: true })),
  isValidProxyUrl: vi.fn(() => true),
}));

import * as detailRoute from '@/app/api/detail/route';
import * as doubanRoute from '@/app/api/douban/route';
import * as suggestRoute from '@/app/api/douban/suggest/route';
import * as liveRoute from '@/app/api/live/playlist/route';
import * as searchRoute from '@/app/api/search/route';

const COOKIE = authCookie();

beforeEach(() => {
  fetchUpstreamMock.mockReset();
});

describe('聚合搜索', () => {
  it('多源结果聚合返回统一结构', async () => {
    fetchUpstreamMock.mockResolvedValue(jsonResponse({ pagecount: 1, list: SEARCH_LIST }));

    const res = await searchRoute.POST(
      jsonRequest('/api/search', { wd: '流浪地球2', sources: [SOURCE] }, COOKIE)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.failures).toEqual([]);
    expect(body.list).toHaveLength(2);
    expect(body.list[0]).toMatchObject({
      sourceKey: SOURCE.key,
      sourceName: SOURCE.name,
      vodId: '101',
      name: '流浪地球2',
    });
  });

  it('同一源内重复条目按 sourceKey+vodId 去重', async () => {
    fetchUpstreamMock.mockResolvedValue(
      jsonResponse({ pagecount: 1, list: [SEARCH_LIST[0], SEARCH_LIST[0]] })
    );

    const res = await searchRoute.POST(
      jsonRequest('/api/search', { wd: '流浪', sources: [SOURCE] }, COOKIE)
    );
    const body = await res.json();

    expect(body.list).toHaveLength(1);
  });

  it('stream=1 按 NDJSON 先推源结果再推 done', async () => {
    fetchUpstreamMock.mockResolvedValue(jsonResponse({ pagecount: 1, list: SEARCH_LIST }));

    const res = await searchRoute.POST(
      jsonRequest('/api/search?stream=1', { wd: '流浪地球', sources: [SOURCE] }, COOKIE)
    );
    const lines = (await res.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const done = lines.at(-1);

    expect(res.status).toBe(200);
    expect(lines.some((line) => line.type === 'source')).toBe(true);
    expect(done.type).toBe('done');
    expect(done.list).toHaveLength(2);
  });
});

describe('详情与换源数据', () => {
  it('详情返回剧集地址与影片信息', async () => {
    fetchUpstreamMock.mockResolvedValue(jsonResponse(DETAIL_PAYLOAD));

    const res = await detailRoute.GET(
      getRequest(
        `/api/detail?id=101&source=${encodeURIComponent(JSON.stringify(SOURCE))}`,
        COOKIE
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.episodes).toEqual(['https://media.example.com/movie/index.m3u8']);
    expect(body.videoInfo.title).toBe('流浪地球2');
  });

  it('详情 ID 非法返回 400', async () => {
    const res = await detailRoute.GET(
      getRequest(
        `/api/detail?id=${encodeURIComponent('bad id!')}&source=${encodeURIComponent(JSON.stringify(SOURCE))}`,
        COOKIE
      )
    );
    expect(res.status).toBe(400);
  });
});

describe('直播订阅', () => {
  it('解析 M3U 返回频道与分组', async () => {
    fetchUpstreamMock.mockResolvedValue(
      new Response(LIVE_M3U, { status: 200, headers: { 'content-type': 'audio/x-mpegurl' } })
    );

    const res = await liveRoute.GET(
      getRequest(
        `/api/live/playlist?url=${encodeURIComponent('https://mock.example.com/live-a.m3u')}`,
        COOKIE
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.channels).toHaveLength(3);
    expect(body.channels[0].name).toBe('CCTV-1');
    expect(body.groups).toEqual(expect.arrayContaining(['央视', '卫视']));
  });

  it('缺少 url 参数返回 400', async () => {
    const res = await liveRoute.GET(getRequest('/api/live/playlist', COOKIE));
    expect(res.status).toBe(400);
  });
});

describe('豆瓣数据', () => {
  it('推荐接口返回影片列表', async () => {
    fetchUpstreamMock.mockResolvedValue(
      jsonResponse({
        subjects: [{ id: '1', title: '黑球', cover: 'https://img.example.com/1.jpg', rate: '8.6' }],
      })
    );

    const res = await doubanRoute.GET(
      getRequest('/api/douban?type=movie&tag=热门&pageSize=2', COOKIE)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: '1', title: '黑球', rating: '8.6' });
  });

  it('搜索联想返回候选影片', async () => {
    fetchUpstreamMock.mockResolvedValue(
      jsonResponse([
        { id: '35267208', title: '流浪地球2', img: 'https://img.example.com/2.jpg', year: '2023' },
      ])
    );

    const res = await suggestRoute.GET(
      getRequest(`/api/douban/suggest?q=${encodeURIComponent('流浪')}`, COOKIE)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('流浪地球2');
  });
});
