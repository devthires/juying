import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnvSubscriptions } from './env-subscriptions';

/**
 * DEFAULT_SUBSCRIPTIONS 解析单测。
 * 重点覆盖三件事：不内置任何默认订阅、refreshDays 的夹取、地址归一化后去重。
 */

const KEY = 'DEFAULT_SUBSCRIPTIONS';
const original = process.env[KEY];

beforeEach(() => {
  delete process.env[KEY];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  vi.restoreAllMocks();
});

const set = (value: unknown) => {
  process.env[KEY] = typeof value === 'string' ? value : JSON.stringify(value);
};

describe('getEnvSubscriptions', () => {
  it('未设置 / 空值 / 空数组都返回空——不内置任何默认订阅', () => {
    expect(getEnvSubscriptions()).toEqual([]);
    set('   ');
    expect(getEnvSubscriptions()).toEqual([]);
    set([]);
    expect(getEnvSubscriptions()).toEqual([]);
  });

  it('支持字符串与对象两种元素', () => {
    set(['https://a.example.com/list.json', { url: 'https://b.example.com/list.json', name: '备用清单' }]);

    expect(getEnvSubscriptions()).toEqual([
      { url: 'https://a.example.com/list.json', name: undefined, refreshDays: undefined },
      { url: 'https://b.example.com/list.json', name: '备用清单', refreshDays: undefined },
    ]);
  });

  it('refreshDays 夹在 1-365，非法值视为未配置', () => {
    set([
      { url: 'https://a.example.com/1.json', refreshDays: 10 },
      { url: 'https://a.example.com/2.json', refreshDays: 0 },
      { url: 'https://a.example.com/3.json', refreshDays: -3 },
      { url: 'https://a.example.com/4.json', refreshDays: 999 },
      { url: 'https://a.example.com/5.json', refreshDays: 1.9 },
      { url: 'https://a.example.com/6.json', refreshDays: '7' },
      { url: 'https://a.example.com/7.json', refreshDays: 'abc' },
    ]);

    expect(getEnvSubscriptions().map((s) => s.refreshDays)).toEqual([10, undefined, undefined, 365, 1, 7, undefined]);
  });

  it('地址归一化后去重：尾斜杠与空的 ? / # 视为同一订阅，名称取首次出现', () => {
    set([
      { url: 'https://a.example.com/list.json/', name: '首个' },
      { url: 'https://a.example.com/list.json?', name: '第二个' },
      { url: 'https://a.example.com/list.json#', name: '第三个' },
    ]);

    expect(getEnvSubscriptions()).toEqual([
      { url: 'https://a.example.com/list.json', name: '首个', refreshDays: undefined },
    ]);
  });

  it('任一项非法则整体忽略（与 DEFAULT_SOURCES 的容错策略一致）', () => {
    set(['https://ok.example.com/list.json', 'ftp://a.example.com/list.json']);
    expect(getEnvSubscriptions()).toEqual([]);

    set({ url: 'https://ok.example.com/list.json' });
    expect(getEnvSubscriptions()).toEqual([]);
  });

  it('refreshDays 不影响地址去重：重复条目仍只保留一条', () => {
    set([
      { url: 'https://a.example.com/list.json', refreshDays: 10 },
      { url: 'https://a.example.com/list.json', refreshDays: 30 },
    ]);

    expect(getEnvSubscriptions()).toEqual([
      { url: 'https://a.example.com/list.json', name: undefined, refreshDays: 10 },
    ]);
  });
});
