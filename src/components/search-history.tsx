'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addSearchHistory, clearSearchHistory, db, removeSearchHistory, restoreSearchHistory } from '@/lib/db';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn, matchesFuzzy } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { useToast } from './toast';
import { Icon } from './icon';
import { SmartImage } from './smart-image';

/** 下拉最多展示条数，与 db 层 MAX_SEARCH_HISTORY 保持一致 */
const HISTORY_LIMIT = 10;

/** 影视联想最多展示条数（豆瓣热度序截断） */
const SUGGEST_LIMIT = 8;

/** 输入联想的防抖间隔：边输入边停顿，避免每个按键都打一次豆瓣 */
const SUGGEST_DEBOUNCE_MS = 250;

/**
 * 「最近搜索」下拉的交互逻辑：聚焦展开、输入时按关键字过滤（浏览器地址栏式交互）。
 * 首页搜索框与顶栏搜索框共用本 hook 与下方 SearchHistoryDropdown，避免两处实现分叉。
 * 输入内容后，下拉顶部追加「影视搜索」联想区（豆瓣热度序候选，海报 + 评分）。
 */
export function useSearchHistory(input: string) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  /** 键盘高亮项下标（联想区 + 历史区拼接后的全局下标），-1 表示未选中 */
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const history = useQuery({
    queryKey: ['searchHistory'],
    queryFn: () => db.searchHistory.orderBy('timestamp').reverse().limit(HISTORY_LIMIT).toArray(),
  });

  const matches = useMemo(() => {
    const all = history.data ?? [];
    const keyword = input.trim().toLowerCase();
    if (!keyword) return all;
    // 先按连续子串过滤，再退回模糊匹配（搜「流地」也能带出「流浪地球」）
    const direct = all.filter((h) => h.text.toLowerCase().includes(keyword));
    if (direct.length > 0) return direct;
    return all.filter((h) => matchesFuzzy(h.text.toLowerCase(), keyword));
  }, [history.data, input]);

  // —— 影视联想：防抖后的关键词 → 豆瓣热度序候选 ——

  /** 防抖关键词：输入停顿后再发起联想请求 */
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input.trim()), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const suggestQuery = useQuery({
    queryKey: ['doubanSuggest', debounced],
    queryFn: ({ signal }) => api.doubanSuggest(debounced, signal),
    enabled: debounced.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  /**
   * 只在「请求已结算且对应的就是当前输入」时展示：
   * 防抖间隙与在途请求期间不展示旧关键词的候选，避免内容闪变。
   */
  const suggestions = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed || debounced !== trimmed || !suggestQuery.isSuccess) return [];
    return (suggestQuery.data?.items ?? []).slice(0, SUGGEST_LIMIT);
  }, [input, debounced, suggestQuery.isSuccess, suggestQuery.data]);

  /** 键盘导航与 aria 共用的拼接选项：联想在前、历史在后 */
  const options = useMemo(
    () => [
      ...suggestions.map((s) => ({ kind: 'suggest' as const, title: s.title })),
      ...matches.map((h) => ({ kind: 'history' as const, title: h.text })),
    ],
    [suggestions, matches]
  );

  // 唯一命中项是「与输入完全一致的历史记录」时不展开：否则会盖住用户刚敲进去的内容
  const visible =
    open &&
    options.length > 0 &&
    !(options.length === 1 && options[0].kind === 'history' && options[0].title === input.trim());

  // 选项变少时收起越界的高亮下标
  const active = activeIndex >= options.length ? -1 : activeIndex;

  // 点按下拉之外的任意位置收起
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [visible]);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  /** 记录一次搜索；顺带刷新下拉数据（历史也会在播放页被写入） */
  const record = (text: string) => {
    addSearchHistory(text)
      .then(() => history.refetch())
      .catch(() => {});
  };

  const remove = (text: string) => {
    setActiveIndex(-1);
    removeSearchHistory(text).then(() => history.refetch());
  };

  const clearAll = async () => {
    const snapshot = history.data ?? [];
    if (snapshot.length === 0) return;
    close();
    await clearSearchHistory();
    await history.refetch();
    // 轻量破坏性操作：给一次撤销机会，不打断式弹确认
    toast('已清空搜索记录', 'info', {
      action: {
        label: '撤销',
        onClick: () => {
          restoreSearchHistory(snapshot).then(() => history.refetch());
        },
      },
    });
  };

  const onFocus = () => {
    setOpen(true);
    history.refetch();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, onPick: (text: string) => void) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (!visible) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      // 有高亮项时 Enter 采用该条候选（联想或历史），不再提交输入框原文
      e.preventDefault();
      onPick(options[active].title);
    }
  };

  return {
    visible,
    suggestions,
    matches,
    activeIndex: active,
    containerRef,
    close,
    record,
    remove,
    clearAll,
    onFocus,
    onKeyDown,
    /** 输入变化时清掉键盘高亮，避免指向已过滤掉的项 */
    resetActive: () => setActiveIndex(-1),
  };
}

/**
 * 搜索联想浮层：紧贴输入框下方，与输入框「拼成同一个面板」。
 * - 不留间隙、不画上边框、上角为直角：上圆角与上边框由输入框容器补齐，
 *   因此接缝处既不会出现缝隙，也不会出现双线；
 * - 外框取 accent 色，与输入框的聚焦边框同色，避免拼接处「上半蓝、下半灰」断色；
 * - 左右内边距与输入框文字（pl-4）对齐，使下拉文字与输入内容在同一条竖线上；
 * - 作为浮层不占文档流，出现/消失不会引起下方内容跳动。
 * - 输入内容后顶部追加「影视搜索」区：豆瓣热度序候选（海报 + 标题 + 评分）。
 */
export function SearchHistoryDropdown({
  id,
  suggestions,
  matches,
  activeIndex,
  onPick,
  onRemove,
  onClearAll,
}: {
  /** 同时作为 listbox 的 id 前缀：外部输入框用 aria-controls 指向它 */
  id: string;
  /** 豆瓣热度序联想候选；为空时整个区块隐藏 */
  suggestions: DoubanItem[];
  matches: { text: string }[];
  activeIndex: number;
  onPick: (text: string) => void;
  onRemove: (text: string) => void;
  onClearAll: () => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  /** 历史区选项的全局起始下标（联想区在前） */
  const historyBase = suggestions.length;

  return (
    <div
      className={cn(
        'absolute left-0 right-0 top-full z-40 overflow-hidden text-left',
        'rounded-b-xl border-x border-b border-accent bg-surface-raised shadow-2xl animate-fade-in'
      )}
    >
      <ul
        id={id}
        role="listbox"
        aria-label="搜索联想"
        className="max-h-[min(70vh,400px)] overflow-y-auto scrollbar-thin py-1"
      >
        {suggestions.length > 0 && (
          <li role="presentation" className="flex items-center gap-1.5 pl-4 pr-2 pt-1 pb-2 text-xs text-faint">
            <Icon name="search" className="w-3.5 h-3.5" />
            影视搜索
          </li>
        )}
        {suggestions.map((s, i) => (
          <li
            key={`suggest-${s.title}`}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === activeIndex}
            className={cn('hover:bg-hover', i === activeIndex && 'bg-hover')}
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 pl-3 pr-3 py-2 text-left"
              onClick={() => onPick(s.title)}
            >
              <span className="w-9 h-12 shrink-0 rounded-md overflow-hidden bg-chip">
                <SmartImage
                  url={s.cover}
                  mode={imageProxyMode}
                  customProxy={customImageProxy}
                  alt={s.title}
                  loading="eager"
                  className="w-full h-full object-cover"
                />
              </span>
              <span className="flex-1 min-w-0 text-sm text-content truncate">{s.title}</span>
              {s.year && <span className="shrink-0 text-xs text-faint">{s.year}</span>}
              <span className="shrink-0 tag">{s.isTv ? '剧集' : '电影'}</span>
            </button>
          </li>
        ))}

        {matches.length > 0 && (
          <li
            role="presentation"
            className="flex items-center justify-between pl-4 pr-2 pt-2 pb-2 text-xs text-faint border-t border-line"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="clock" className="w-3.5 h-3.5" />
              最近搜索
            </span>
            <button
              type="button"
              className="px-2 py-1 rounded-md text-xs text-faint hover:text-danger hover:bg-hover transition-colors"
              onClick={onClearAll}
            >
              清空
            </button>
          </li>
        )}
        {matches.map((h, j) => (
          <li
            key={h.text}
            id={`${id}-${historyBase + j}`}
            role="option"
            aria-selected={historyBase + j === activeIndex}
            className={cn(
              'flex items-center hover:bg-hover',
              historyBase + j === activeIndex && 'bg-hover'
            )}
          >
            <button
              type="button"
              className="flex-1 min-w-0 pl-4 pr-2 py-2.5 text-left text-sm text-content truncate"
              onClick={() => onPick(h.text)}
            >
              {h.text}
            </button>
            <button
              type="button"
              className="shrink-0 p-1.5 mr-2 rounded-md text-faint hover:text-danger hover:bg-chip transition-colors"
              aria-label={`删除搜索记录 ${h.text}`}
              onClick={() => onRemove(h.text)}
            >
              <Icon name="close" className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
