'use client';

import { ApiError, api } from './client-api';
import { normalizeSubscriptionUrl } from './source-list';
import { useAppStore, type SourceSubscription } from './store';
import { describeParseStats } from './tvbox-parser';
import type { AuthStatusResponse, SubscriptionParseStats } from './types';

/**
 * 数据源订阅同步核心逻辑，供两处复用：
 * - source-manager：用户在设置抽屉中手动添加/重新同步（UI 层加 toast 反馈）；
 * - providers：部署者通过 DEFAULT_SUBSCRIPTIONS 预置的订阅，启动时自动导入与静默重同步。
 *
 * 订阅内容由服务端自动识别格式（LibreTV-SourceList JSON、TVBOX 配置 JSON 或接口目录 JSON），
 * applySubscriptionSources / applySubscriptionLive 均按订阅前缀整体替换且保留
 * 用户勾选状态，同步失败时不调用即无副作用——旧数据自动保留。
 */
export interface SubscriptionSyncResult {
  name?: string;
  vodCount: number;
  liveCount: number;
  /** 解析统计（识别格式、跳过与截断条目），用于导入结果提示 */
  stats?: SubscriptionParseStats;
}

export async function syncSourceSubscription(rawUrl: string): Promise<SubscriptionSyncResult> {
  // 统一归一化（trim + 去尾斜杠）：与 DEFAULT_SUBSCRIPTIONS 预置地址保持同一形态，
  // 避免同一订阅地址因尾斜杠差异被存成两条订阅
  const url = normalizeSubscriptionUrl(rawUrl);
  try {
    const { name, sources, liveSources, stats } = await api.fetchSourceList(url);
    if (sources.length === 0 && liveSources.length === 0) {
      throw new Error('订阅内容为空');
    }
    const store = useAppStore.getState();
    const vodCount = store.applySubscriptionSources(url, sources);
    const liveCount = store.applySubscriptionLive(url, liveSources);
    // 仅对本订阅引用的直播源记录同步时间（多归属：共享源也会被标记为新鲜，
    // 但名称/EPG 由 store 的「首次导入为准、缺失补齐」语义保护，不会被本订阅覆盖）
    const importedLiveUrls = new Set(
      useAppStore.getState().liveSubscriptions
        .filter((s) => s.fromSubscriptions.includes(url))
        .map((s) => s.url)
    );
    for (const s of liveSources) {
      if (importedLiveUrls.has(s.url)) store.markLiveSynced(s.url, s.name, s.epg);
    }
    store.addSubscription(url, name);
    store.markSubscriptionSynced(url, name, { vod: vodCount, live: liveCount });
    return { name, vodCount, liveCount, stats };
  } catch (err) {
    // 记录失败状态供订阅列表展示（首次添加未成功时不产生条目）；已导入的旧数据保持不动
    const message = err instanceof Error ? err.message : '订阅同步失败';
    // 鉴权失败是会话问题，不是源的问题：计入连续失败会让自动刷新被误暂停
    const authFailure = err instanceof ApiError && (err.status === 401 || err.status === 503);
    useAppStore.getState().markSubscriptionFailed(url, message, { countFailure: !authFailure });
    throw err instanceof Error ? err : new Error(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 预置订阅的刷新周期缺省值：未单独指定 refreshDays 时按天检查。
 * 这里不 import env-subscriptions 的常量——那个模块只被 /api/status 使用，
 * 是服务端模块（读 process.env），而本模块是 'use client'，没必要把它带进客户端 bundle。
 * 两边数值必须一致，由 subscription-sync.test.ts 断言兜住。
 */
export const DEFAULT_ENV_SUB_REFRESH_DAYS = 1;

/** 自动刷新：同时最多 2 个、单次启动最多 5 个，避免打开站点时向上游打出一串请求 */
const AUTO_REFRESH_CONCURRENCY = 2;
const AUTO_REFRESH_MAX_PER_RUN = 5;
/** 连续失败达到该次数后暂停自动刷新（手动同步成功一次即恢复） */
export const AUTO_REFRESH_MAX_FAIL_STREAK = 3;

/** 周期（天）→ 毫秒；未设置或非法值返回 undefined（调用方据此判定「不自动刷新」） */
export function refreshIntervalMs(days: number | undefined): number | undefined {
  if (!days || !Number.isFinite(days) || days <= 0) return undefined;
  return days * DAY_MS;
}

/**
 * 距上次同步是否已满周期（满即刷新，与旧版 24h 的边界语义一致）。
 * 从未同步过视为该刷新：设了周期却一直没同步过的订阅，没有理由继续等。
 */
export function isRefreshDue(
  lastSync: number | undefined,
  days: number | undefined,
  now = Date.now()
): boolean {
  const interval = refreshIntervalMs(days);
  if (!interval) return false;
  if (!lastSync) return true;
  return now - lastSync >= interval;
}

/** 该订阅此刻是否该自动刷新：未设周期、或连续失败已触顶的一律不刷 */
export function canAutoRefresh(sub: SourceSubscription, now = Date.now()): boolean {
  if (!sub.refreshDays) return false;
  if ((sub.failStreak ?? 0) >= AUTO_REFRESH_MAX_FAIL_STREAK) return false;
  return isRefreshDue(sub.lastSync, sub.refreshDays, now);
}

/** 同一时刻只允许一轮自动刷新（首屏与登录后各调一次 applyEnvPresets，会撞在一起） */
let autoRefreshRunning = false;

/**
 * 用户订阅的自动刷新：**打开站点时执行一次**，不是定时器。
 *
 * 只处理显式设了 `refreshDays` 的订阅——默认（undefined）仍是纯手动，
 * 因此这个功能对存量用户完全无感，不会因为升级就凭空多出一堆上游请求。
 *
 * 护栏：
 * - 离线、后台标签页（document.hidden）直接跳过；
 * - 单次最多 AUTO_REFRESH_MAX_PER_RUN 个、并发 AUTO_REFRESH_CONCURRENCY；
 * - 连续失败 AUTO_REFRESH_MAX_FAIL_STREAK 次暂停，手动同步成功后自动恢复；
 * - 全程静默：失败只更新订阅行状态，不弹 toast（用户没主动操作，弹窗是打扰）。
 */
export async function autoRefreshSubscriptions(now = Date.now()): Promise<void> {
  if (autoRefreshRunning) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const due = useAppStore
    .getState()
    .subscriptions.filter((s) => canAutoRefresh(s, now))
    .slice(0, AUTO_REFRESH_MAX_PER_RUN);
  if (due.length === 0) return;

  autoRefreshRunning = true;
  try {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < due.length) {
        const sub = due[cursor++];
        try {
          await syncSourceSubscription(sub.url);
        } catch {
          // 失败已由 syncSourceSubscription 写入订阅状态（含连续失败计数）
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(AUTO_REFRESH_CONCURRENCY, due.length) }, () => worker())
    );
  } finally {
    autoRefreshRunning = false;
  }
}

/**
 * 部署者通过 DEFAULT_SUBSCRIPTIONS 预置的订阅：启动时自动导入与静默刷新。
 *
 * seen 标记（envSubsSeen）仅在同步成功后写入：
 * - 同步成功 → 标记 seen，用户此后删除该订阅不会被自动加回；
 * - 同步失败 → 不标记，下次启动自动重试，已导入的旧数据保持不动。
 * 已存在的订阅按各自周期判断：用户在面板里显式设过 refreshDays 就以用户的为准，
 * 其次才是部署者在环境变量里给的值，都没有则 1 天。
 */
export async function syncEnvSubscriptions(
  subs: { url: string; name?: string; refreshDays?: number }[]
): Promise<void> {
  for (const sub of subs) {
    const store = useAppStore.getState();
    try {
      const existing = store.subscriptions.find((s) => s.url === sub.url);
      // 源列表更新频率差异很大（日更榜单 vs 季度维护），周期按订阅各算各的
      const days = existing?.refreshDays ?? sub.refreshDays ?? DEFAULT_ENV_SUB_REFRESH_DAYS;
      const refreshMs = days * DAY_MS;
      let result: SubscriptionSyncResult | undefined;
      if (existing) {
        if (existing.lastSync && Date.now() - existing.lastSync < refreshMs) {
          store.markEnvSubsSeen([sub.url]);
          continue;
        }
        result = await syncSourceSubscription(sub.url);
      } else {
        // 已成功过且被用户删除的预置订阅：尊重用户选择，不再加回
        if (store.envSubsSeen.includes(sub.url)) continue;
        result = await syncSourceSubscription(sub.url);
      }
      // 预置订阅对用户是静默的，跳过/截断情况写入控制台供部署者排查（只记计数，不打印配置内容）
      if (result?.stats && result.stats.skipped > 0) {
        console.info('[LibreTV] 预置订阅部分条目未导入：', sub.url, describeParseStats(result.stats));
      }
      useAppStore.getState().markEnvSubsSeen([sub.url]);
    } catch (err) {
      console.warn('[LibreTV] 预置订阅同步失败（下次启动将重试）：', sub.url, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * 应用 /api/status 下发的部署者预置数据（预置点播源 / 预置直播源 / 预置订阅）。
 *
 * 调用点有两处，缺一不可：
 * - Providers 首屏拿到 /api/status 后调用（此时可能尚未登录）；
 * - AuthProvider 登录成功后补调一次——预置订阅要经鉴权接口 /api/source-list 拉取，
 *   首屏那次在登录前会 401 静默失败，不补调则本次会话内不会出现预置订阅。
 *
 * 重复调用是安全的：setEnvSources / setLiveEnvSources 幂等，syncEnvSubscriptions
 * 对未满刷新周期（各订阅自己的 refreshDays，缺省 1 天）的订阅会跳过，
 * 对已成功过的订阅也不会重复导入。
 *
 * `options.verified` 覆盖「当前是否已登录」的判断：登录成功后 AuthProvider 拿到的
 * 是**登录前**的缓存 status（verified 仍为 false），此时必须由调用方显式告知已登录，
 * 否则用户订阅的自动刷新要等到下次刷新页面才可能生效。
 */
export async function applyEnvPresets(
  status: AuthStatusResponse,
  options?: { verified?: boolean }
): Promise<void> {
  if (Array.isArray(status.defaultSources)) {
    useAppStore.getState().setEnvSources(status.defaultSources);
  }
  if (Array.isArray(status.defaultLiveSources)) {
    useAppStore.getState().setLiveEnvSources(status.defaultLiveSources);
  }
  if (Array.isArray(status.defaultSubscriptions) && status.defaultSubscriptions.length > 0) {
    await syncEnvSubscriptions(status.defaultSubscriptions);
  }
  // 用户订阅的自动刷新：/api/source-list 需要鉴权，未登录时调用只会白拿一堆 401。
  // 放在预置订阅之后，预置订阅刚同步过的条目这里会因「未满周期」自然跳过。
  if (options?.verified ?? status.verified) {
    await autoRefreshSubscriptions();
  }
  // 部署者通过 DEFAULT_RECOMMEND_SOURCE 指定的推荐数据源默认值：
  // 仅对未主动选择过的用户生效（仍为出厂默认 hot-list 且无「已选择」标记），
  // 已有偏好的用户——包括清缓存前做过选择的——不被覆盖，用户的选择始终优先。
  // 直写 setState 而非 updateSettings：自动预置不算用户主动选择，不打「已选择」标记；
  // 应用后当前值 ≠ hot-list，AuthProvider 的幂等重入天然跳过。
  if (status.defaultRecommendSource) {
    const s = useAppStore.getState();
    if (!s.recommendSourceTouched && s.recommendSource === 'hot-list') {
      useAppStore.setState({ recommendSource: status.defaultRecommendSource });
    }
  }
  // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时不改动）。
  // 与推荐数据源同一套语义：仅对未主动选择过的用户生效（仍为出厂默认 direct 且无
  // 「已选择」标记），已有偏好的用户——包括 touched 标记上线前手动改过的——不被覆盖；
  // custom 需要手填模板，无论有无标记都视为明确选择，不覆盖。
  // 直写 setState 而非 updateSettings：自动预置不算用户主动选择，不打「已选择」标记。
  if (status.defaultImageMode) {
    const s = useAppStore.getState();
    if (!s.imageProxyModeTouched && s.imageProxyMode === 'direct') {
      useAppStore.setState({ imageProxyMode: status.defaultImageMode });
    }
  }
}
