import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptSegment, PauseResumeController, runDownloadJob, type DownloadJobOptions, type DownloadProgress } from './m3u8-downloader';
import { parseM3u8Playlist } from './m3u8-parse';

const KEY = crypto.getRandomValues(new Uint8Array(16));
const asBuf = (v: Uint8Array): BufferSource => v.buffer as ArrayBuffer;
const PLAINTEXT = crypto.getRandomValues(new Uint8Array(188 * 3));

async function encryptForIv(plaintext: BufferSource, iv: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', asBuf(KEY), 'AES-CBC', false, ['encrypt']);
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv: asBuf(iv) }, cryptoKey, plaintext);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decryptSegment', () => {
  it('显式 IV：密文往返还原明文', async () => {
    const cipher = await encryptForIv(PLAINTEXT, new Uint8Array(16).fill(0xab));
    const out = await decryptSegment(cipher, asBuf(KEY), 'ab'.repeat(16), 0, 0);
    expect(new Uint8Array(out)).toEqual(PLAINTEXT);
  });

  it('无 IV 属性：IV = mediaSequence + 分片序号（16 字节大端），逐分片递增', async () => {
    // 分片 0（媒体序列号 5 → IV=5）与分片 1（IV=6）用各自正确的 IV 加密
    const ivOf = (seq: number) => {
      const iv = new Uint8Array(16);
      iv[15] = seq;
      return iv;
    };
    const cipher0 = await encryptForIv(PLAINTEXT, ivOf(5));
    const cipher1 = await encryptForIv(PLAINTEXT, ivOf(6));

    const out0 = await decryptSegment(cipher0, asBuf(KEY), undefined, 5, 0);
    expect(new Uint8Array(out0)).toEqual(PLAINTEXT);
    const out1 = await decryptSegment(cipher1, asBuf(KEY), undefined, 5, 1);
    expect(new Uint8Array(out1)).toEqual(PLAINTEXT);
  });

  it('回归：旧实现恒用零向量 IV——对非零序列号分片解密必然失败', async () => {
    // 分片按正确 IV=6 加密；旧实现对无 IV 属性的 KEY 恒用零向量 → 解不出明文
    const cipher = await encryptForIv(PLAINTEXT, ivOf6());
    const zeroIv = '00'.repeat(16);
    const out = await decryptSegment(cipher, asBuf(KEY), zeroIv, 5, 1).catch(
      () => new ArrayBuffer(0)
    );
    const same =
      out.byteLength === PLAINTEXT.byteLength &&
      new Uint8Array(out).every((b, i) => b === PLAINTEXT[i]);
    expect(same).toBe(false);
  });
});

function ivOf6(): Uint8Array {
  const iv = new Uint8Array(16);
  iv[15] = 6;
  return iv;
}

describe('parseM3u8Playlist · mediaSequence 与 AES URI 绝对化', () => {
  it('解析 EXT-X-MEDIA-SEQUENCE，AES key 相对地址转绝对', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:15',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:4,',
      'seg0.ts',
      '#EXTINF:4,',
      'seg1.ts',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(playlist, { status: 200 }))
    );

    const parsed = await parseM3u8Playlist('https://cdn.example.com/live/index.m3u8');
    expect(parsed.mediaSequence).toBe(15);
    expect(parsed.aesConf?.uri).toBe('https://cdn.example.com/live/key.bin');
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].url).toBe('https://cdn.example.com/live/seg0.ts');
  });

  it('缺省 MEDIA-SEQUENCE 时为 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('#EXTM3U\n#EXTINF:4,\nseg.ts', { status: 200 }))
    );
    const parsed = await parseM3u8Playlist('https://cdn.example.com/a.m3u8');
    expect(parsed.mediaSequence).toBe(0);
  });
});

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:4,',
  's0.ts',
  '#EXTINF:4,',
  's1.ts',
  '#EXTINF:4,',
  's2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

/** 极简 Cache Storage 替身：只实现 runDownloadJob 用到的 match/put/keys/delete */
function stubCaches(onPut?: () => Promise<void>): void {
  const store = new Map<string, ArrayBuffer>();
  const cache = {
    match: async (req: Request) => {
      const hit = store.get(req.url);
      return hit ? new Response(hit.slice(0)) : undefined;
    },
    put: async (req: Request, res: Response) => {
      if (onPut) {
        await onPut();
        return;
      }
      store.set(req.url, await res.arrayBuffer());
    },
    keys: async () => [...store.keys()].map((u) => new Request(u)),
    delete: async (req: Request) => store.delete(req.url),
  };
  vi.stubGlobal('caches', { open: async () => cache });
}

function jobOptions(overrides: Partial<DownloadJobOptions> = {}): DownloadJobOptions {
  return {
    taskId: 'task-1',
    url: 'https://cdn.example.com/index.m3u8',
    title: '测试剧集',
    format: 'TS',
    concurrency: 1,
    signal: new AbortController().signal,
    pause: new PauseResumeController(),
    onProgress: () => {},
    target: { kind: 'memory', write: async () => {}, close: async () => {}, abort: async () => {} },
    ...overrides,
  };
}

describe('runDownloadJob · 源站缺片与存储错误', () => {
  it('分片 404 视为确定性缺失：不重试、立即失败并提示换源', async () => {
    stubCaches();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
        if (url.endsWith('s1.ts')) return new Response('', { status: 404 });
        return new Response(new Uint8Array([0x47, 0x40, 0x11, 0x10]), { status: 200 });
      })
    );

    const job = runDownloadJob(jobOptions());
    await expect(job).rejects.toThrow(/分片 2 源站缺失/);
    await expect(job).rejects.toThrow(/建议更换来源/);
    // 不重试：m3u8 一次 + s0 一次 + s1 一次（整集失败后 s2 不再请求）
    expect(calls.filter((u) => u.endsWith('.ts'))).toEqual([
      'https://cdn.example.com/s0.ts',
      'https://cdn.example.com/s1.ts',
    ]);
  });

  it('5xx 仍走退避重试，重试耗尽后才失败', async () => {
    stubCaches();
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
      return new Response('', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const job = runDownloadJob(jobOptions());
    const assertion = expect(job).rejects.toThrow(/已重试 3 次/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    const segCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('.ts'));
    expect(segCalls).toHaveLength(3);
    vi.useRealTimers();
  });

  it('缓存写入失败（如配额不足）时给出可读提示', async () => {
    stubCaches(async () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
        return new Response(new Uint8Array([0x47]), { status: 200 });
      })
    );

    await expect(runDownloadJob(jobOptions())).rejects.toThrow(/存储空间可能不足/);
  });

  it('环境无 Cache Storage（HTTP 访问 / 老浏览器）：退化为串行边下边写而非直接失败', async () => {
    // 不提供 caches：等价于非安全上下文。旧行为是抛「不支持浏览器缓存」，
    // 现改为串行下载 + 立即写出（无断点、并发 1），功能仍可用
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
        return new Response(new Uint8Array([0x47]), { status: 200 });
      })
    );
    const written: number[] = [];
    const progress: DownloadProgress[] = [];

    await runDownloadJob(
      jobOptions({
        target: {
          kind: 'memory',
          write: async (d) => void written.push(d.byteLength),
          close: async () => {},
          abort: async () => {},
        },
        onProgress: (p) => progress.push(p),
      })
    );

    expect(written).toHaveLength(3);
    expect(progress.at(-1)?.status).toBe('done');
  });

  it('proxy 开启：m3u8 经 /api/proxy 拉取（直连被 CORS / 混合内容拦下时的兜底）', async () => {
    stubCaches();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith('/api/proxy?')) return new Response(PLAYLIST, { status: 200 });
        return new Response(new Uint8Array([0x47]), { status: 200 });
      })
    );

    await runDownloadJob(jobOptions({ proxy: true }));

    expect(calls[0]).toBe(`/api/proxy?url=${encodeURIComponent('https://cdn.example.com/index.m3u8')}`);
    expect(calls).not.toContain('https://cdn.example.com/index.m3u8');
  });

  it('跨域或域名不可达导致的 Failed to fetch 翻译成「建议更换来源」', async () => {
    stubCaches();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(runDownloadJob(jobOptions())).rejects.toThrow(
      /无法直连该来源（跨域限制或域名不可达），建议更换来源/
    );
  });

  it('HTTPS 页面遇到 http 来源时提示混合内容被拦截', async () => {
    stubCaches();
    vi.stubGlobal('location', { protocol: 'https:' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    await expect(runDownloadJob(jobOptions({ url: 'http://cdn.example.com/index.m3u8' }))).rejects.toThrow(
      /混合内容被拦截/
    );
  });
});

describe('runDownloadJob · 写出阶段容错', () => {
  it('缓存被驱逐（写出阶段 match 不到）时回源补拉而非判死整集', async () => {
    // put 全部丢弃：模拟存储压力下 Cache Storage 驱逐——下载阶段看似正常推进，
    // 写出阶段读不到任何分片。旧行为直接抛「分片 1 缓存丢失」判死已下完的任务
    stubCaches(async () => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
      return new Response(new Uint8Array([0x47]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const written: number[] = [];

    await runDownloadJob(
      jobOptions({
        target: {
          kind: 'memory',
          write: async (d) => void written.push(d.byteLength),
          close: async () => {},
          abort: async () => {},
        },
      })
    );

    expect(written).toHaveLength(3);
    // 每个分片被取两次：下载阶段一次 + 写出阶段缓存丢失回源补拉一次
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('.ts'))).toHaveLength(6);
  });

  it('缓存内容损坏（解密失败）时回源重拉，重拉正常则任务完成', async () => {
    const store = new Map<string, ArrayBuffer>();
    const cache = {
      match: async (req: Request) => {
        const hit = store.get(req.url);
        return hit ? new Response(hit.slice(0)) : undefined;
      },
      // 存进去的是垃圾数据：模拟分片写缓存后损坏 / 被截断
      put: async (req: Request) => {
        store.set(req.url, new ArrayBuffer(16));
      },
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      delete: async (req: Request) => store.delete(req.url),
    };
    vi.stubGlobal('caches', { open: async () => cache });
    const iv = new Uint8Array(16).fill(0xab);
    const cipher = await encryptForIv(PLAINTEXT, iv);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('index.m3u8')) {
          return new Response(
            ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x' + 'ab'.repeat(16), '#EXTINF:4,', 's0.ts', '#EXT-X-ENDLIST'].join('\n'),
            { status: 200 }
          );
        }
        if (url.endsWith('key.bin')) return new Response(KEY.slice(0), { status: 200 });
        return new Response(cipher.slice(0), { status: 200 });
      })
    );
    const written: number[] = [];

    await runDownloadJob(
      jobOptions({
        format: 'TS',
        target: {
          kind: 'memory',
          write: async (d) => void written.push(d.byteLength),
          close: async () => {},
          abort: async () => {},
        },
      })
    );

    expect(written).toHaveLength(1);
    expect(written[0]).toBe(PLAINTEXT.byteLength);
  });

  it('分片写出成功后立即释放缓存条目，避免长任务撑爆配额', async () => {
    const store = new Map<string, ArrayBuffer>();
    const cache = {
      match: async (req: Request) => {
        const hit = store.get(req.url);
        return hit ? new Response(hit.slice(0)) : undefined;
      },
      put: async (req: Request, res: Response) => {
        store.set(req.url, await res.arrayBuffer());
      },
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      delete: async (req: Request) => store.delete(req.url),
    };
    vi.stubGlobal('caches', { open: async () => cache });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('index.m3u8')) return new Response(PLAYLIST, { status: 200 });
        return new Response(new Uint8Array([0x47]), { status: 200 });
      })
    );

    await runDownloadJob(jobOptions());

    expect(store.size).toBe(0);
  });
});
