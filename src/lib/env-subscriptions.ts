import { normalizeUrl } from './source-list';

/**
 * 部署者通过 DEFAULT_SUBSCRIPTIONS 环境变量预置的 SourceList 订阅链接。
 * 格式为 JSON 数组，元素为 URL 字符串或 {url, name, refreshDays} 对象：
 *   ["https://.../sources.json", {"url":"https://.../list.json","name":"名称","refreshDays":10}]
 * 与 DEFAULT_SOURCES / DEFAULT_LIVE_SOURCES 的容错策略一致：解析失败整体忽略。
 *
 * 刻意**不内置任何默认订阅**：预置源必须由部署者显式声明，否则升级即让所有部署
 * 凭空多出第三方源，源失效/被劫持都会变成项目责任（DEFAULT_SOURCES 同理）。
 */

/** 订阅刷新周期缺省值（天）：未写 refreshDays 时按每天检查一次 */
export const DEFAULT_ENV_SUB_REFRESH_DAYS = 1;
const MIN_REFRESH_DAYS = 1;
const MAX_REFRESH_DAYS = 365;

export interface EnvSubscription {
  url: string;
  name?: string;
  /** 该订阅的刷新周期（天），夹在 1-365；缺省时按 DEFAULT_ENV_SUB_REFRESH_DAYS */
  refreshDays?: number;
}

/**
 * 解析刷新周期：只接受正数，向下取整后夹在 [1, 365]。
 * 数字字符串一并接受——JSON 配置里把天数写成 "10" 很常见，
 * 直接判为非法会静默退回 1 天，用户看不出「写了却没生效」。
 * 0 / 负数 / 非数字一律视为未配置（不做「0 = 不刷新」这类隐式约定）。
 */
function parseRefreshDays(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(MAX_REFRESH_DAYS, Math.max(MIN_REFRESH_DAYS, Math.floor(n)));
}

export function getEnvSubscriptions(): EnvSubscription[] {
  const raw = process.env.DEFAULT_SUBSCRIPTIONS;
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const seen = new Set<string>();
    const list: EnvSubscription[] = [];
    parsed.forEach((item, i) => {
      const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : undefined;
      const rawUrl = typeof item === 'string' ? item : typeof record?.url === 'string' ? String(record.url) : '';
      // 归一化（去尾斜杠与空的 ?/#）与校验共用 normalizeUrl，避免与订阅存储侧的规则分叉
      const url = normalizeUrl(rawUrl, true);
      if (!url) throw new Error(`第 ${i + 1} 项不是合法的 http(s) 订阅地址`);
      // 按 url 去重（先到先得）：同一地址写两遍只订阅一次，名称以首次出现为准
      if (seen.has(url)) return;
      seen.add(url);
      const name = typeof record?.name === 'string' ? record.name.trim() || undefined : undefined;
      list.push({ url, name, refreshDays: parseRefreshDays(record?.refreshDays) });
    });
    return list;
  } catch (err) {
    console.warn('[LibreTV] DEFAULT_SUBSCRIPTIONS 解析失败，已忽略：', err instanceof Error ? err.message : err);
    return [];
  }
}
