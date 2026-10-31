import { SESSION_COOKIE, signSession } from '@/lib/auth';

export const TEST_PASSWORD = 'test-password';

export const SOURCE = {
  key: 'mock',
  name: 'Mock源',
  url: 'https://mock.example.com/api.php/provide/vod',
  isAdult: false,
};

/** 生成合法会话 Cookie，等价于用户通过 /api/auth 登录后的状态 */
export function authCookie(): string {
  const { token } = signSession();
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

export function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function getRequest(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const SEARCH_LIST = [
  {
    vod_id: 101,
    vod_name: '流浪地球2',
    vod_pic: 'https://img.example.com/p101.jpg',
    vod_remarks: '正片',
    type_name: '科幻片',
    vod_year: '2023',
    vod_area: '中国大陆',
  },
  {
    vod_id: 102,
    vod_name: '流浪地球2：再次冒险',
    vod_pic: 'https://img.example.com/p102.jpg',
    vod_remarks: 'HD',
    type_name: '纪录片',
    vod_year: '2024',
    vod_area: '中国大陆',
  },
];

export const DETAIL_PAYLOAD = {
  list: [
    {
      vod_id: 101,
      vod_name: '流浪地球2',
      vod_pic: 'https://img.example.com/p101.jpg',
      vod_content: '太阳危机下的人类自救计划。',
      vod_play_url: '正片$https://media.example.com/movie/index.m3u8',
    },
  ],
};

export const LIVE_M3U = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV-1" tvg-logo="https://img.example.com/cctv1.png" group-title="央视",CCTV-1',
  'https://media.example.com/live/cctv1.m3u8',
  '#EXTINF:-1 tvg-id="cctv2" group-title="央视",CCTV-2',
  'https://media.example.com/live/cctv2.m3u8',
  '#EXTINF:-1 tvg-id="hunan" group-title="卫视",湖南卫视',
  'https://media.example.com/live/hunan.m3u8',
].join('\n');
