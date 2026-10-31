import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as authRoute from '@/app/api/auth/route';
import * as publishRoute from '@/app/api/publish/route';
import * as searchRoute from '@/app/api/search/route';
import * as statusRoute from '@/app/api/status/route';
import { SOURCE, TEST_PASSWORD, authCookie, getRequest, jsonRequest } from './helpers';

beforeEach(() => {
  process.env.PASSWORD = TEST_PASSWORD;
});

afterEach(() => {
  process.env.PASSWORD = TEST_PASSWORD;
});

describe('登录与会话', () => {
  it('未登录访问 status：要求密码且未验证', async () => {
    const res = await statusRoute.GET(getRequest('/api/status'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passwordRequired).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.version).toBeTruthy();
  });

  it('错误密码返回 401', async () => {
    const res = await authRoute.POST(jsonRequest('/api/auth', { password: 'wrong-password' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('密码错误');
  });

  it('正确密码返回 200 并下发 httpOnly 会话 Cookie', async () => {
    const res = await authRoute.POST(jsonRequest('/api/auth', { password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('ltv_session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('携带会话访问 status：verified=true', async () => {
    const res = await statusRoute.GET(getRequest('/api/status', authCookie()));
    expect((await res.json()).verified).toBe(true);
  });

  it('携带会话查询 auth：verified=true', async () => {
    const res = await authRoute.GET(getRequest('/api/auth', authCookie()));
    expect(await res.json()).toEqual({ success: true, verified: true });
  });

  it('登出返回清除 Cookie 的响应', async () => {
    const res = await authRoute.DELETE();
    const setCookie = res.headers.get('set-cookie') || '';
    expect(res.status).toBe(200);
    expect(setCookie).toContain('ltv_session=');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  it('未登录调用发布接口返回 401', async () => {
    const res = await publishRoute.POST(
      jsonRequest('/api/publish', { name: 'x', sources: [] })
    );
    expect(res.status).toBe(401);
  });

  it('未配置 PASSWORD 时 status 提示无需密码，受保护接口返回 503', async () => {
    process.env.PASSWORD = '';
    const status = await statusRoute.GET(getRequest('/api/status'));
    expect((await status.json()).passwordRequired).toBe(false);

    const search = await searchRoute.POST(
      jsonRequest('/api/search', { wd: '测试', sources: [SOURCE] }, authCookie())
    );
    expect(search.status).toBe(503);
  });
});
