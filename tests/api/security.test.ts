import { describe, expect, it } from 'vitest';
import * as proxyRoute from '@/app/api/proxy/route';
import * as publishRoute from '@/app/api/publish/route';
import * as searchRoute from '@/app/api/search/route';
import * as sourceListRoute from '@/app/api/source-list/route';
import { SOURCE, authCookie, getRequest, jsonRequest } from './helpers';

const COOKIE = authCookie();

describe('SSRF 与地址校验', () => {
  it('内网采集源不被请求，而是作为单源失败返回', async () => {
    const res = await searchRoute.POST(
      jsonRequest(
        '/api/search',
        {
          wd: '测试',
          sources: [{ ...SOURCE, url: 'http://127.0.0.1:8080/api.php/provide/vod' }],
        },
        COOKIE
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.list).toEqual([]);
    expect(body.failures[0].error).toContain('不在允许范围');
  });

  it('订阅源为内网地址返回 403', async () => {
    const res = await sourceListRoute.GET(
      getRequest(
        `/api/source-list?url=${encodeURIComponent('http://127.0.0.1:8080/list.json')}`,
        COOKIE
      )
    );
    expect(res.status).toBe(403);
  });

  it('订阅源非 http 协议返回 400', async () => {
    const res = await sourceListRoute.GET(
      getRequest(
        `/api/source-list?url=${encodeURIComponent('file:///C:/Windows/win.ini')}`,
        COOKIE
      )
    );
    expect(res.status).toBe(400);
  });

  it('代理拒绝云元数据地址', async () => {
    const res = await proxyRoute.GET(
      getRequest(
        `/api/proxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`,
        COOKIE
      )
    );
    expect(res.status).toBe(400);
  });

  it('代理拒绝非 http/https 协议', async () => {
    const res = await proxyRoute.GET(
      getRequest(`/api/proxy?url=${encodeURIComponent('file:///C:/Windows/win.ini')}`, COOKIE)
    );
    expect(res.status).toBe(400);
  });

  it('代理缺少 url 参数返回 400', async () => {
    const res = await proxyRoute.GET(getRequest('/api/proxy', COOKIE));
    expect(res.status).toBe(400);
  });
});

describe('参数边界校验', () => {
  it('空搜索词返回 400', async () => {
    const res = await searchRoute.POST(
      jsonRequest('/api/search', { wd: '  ', sources: [SOURCE] }, COOKIE)
    );
    expect(res.status).toBe(400);
  });

  it('搜索词超过 100 字符返回 400', async () => {
    const res = await searchRoute.POST(
      jsonRequest('/api/search', { wd: 'a'.repeat(101), sources: [SOURCE] }, COOKIE)
    );
    expect(res.status).toBe(400);
  });

  it('未提供点播源返回 400', async () => {
    const res = await searchRoute.POST(
      jsonRequest('/api/search', { wd: '测试', sources: [] }, COOKIE)
    );
    expect(res.status).toBe(400);
  });

  it('非法 JSON 请求体返回 400', async () => {
    const res = await searchRoute.POST(jsonRequest('/api/search', '{bad json', COOKIE));
    expect(res.status).toBe(400);
  });

  it('发布非法 JSON 返回 400', async () => {
    const res = await publishRoute.POST(jsonRequest('/api/publish', '{bad json', COOKIE));
    expect(res.status).toBe(400);
  });

  it('发布空源列表返回 400', async () => {
    const res = await publishRoute.POST(
      jsonRequest('/api/publish', { name: 'empty', sources: [], liveSources: [] }, COOKIE)
    );
    expect(res.status).toBe(400);
  });
});
