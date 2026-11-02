'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { SmartImage } from './smart-image';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';

interface HomeHeroProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  items: DoubanItem[];
  searchSlot: ReactNode;
  onPick: (title: string) => void;
  onLive: () => void;
}

/** 首页 Hero：左侧搜索与快捷入口，右侧复用推荐数据做精选海报堆叠 */
export function HomeHero({ eyebrow, title, subtitle, items, searchSlot, onPick, onLive }: HomeHeroProps) {
  const hotSearches = items.slice(0, 3);

  return (
    <section
      aria-label="聚影推荐"
      className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-surface"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(90% 120% at 86% 0%, rgb(var(--c-accent) / 0.16), transparent 55%), radial-gradient(70% 90% at 100% 100%, rgba(255,60,120,0.10), transparent 60%), linear-gradient(120deg, rgb(var(--c-surface)) 0%, rgb(var(--c-page)) 100%)',
        }}
      />
      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">{eyebrow}</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-content sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>

          <div className="mt-5 max-w-xl">{searchSlot}</div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hotSearches.length > 0 && <span className="text-xs text-faint">热门搜索</span>}
            {hotSearches.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item.title)}
                className="rounded-full bg-chip px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {item.title}
              </button>
            ))}
            <button
              type="button"
              onClick={onLive}
              className="rounded-full bg-chip px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              直播
            </button>
          </div>
        </div>

        <div className="hidden lg:block">
          <HeroPosterStack items={items} onPick={onPick} />
        </div>
      </div>
    </section>
  );
}

function HeroPosterStack({ items, onPick }: { items: DoubanItem[]; onPick: (title: string) => void }) {
  const posters = items.slice(0, 3);
  const positions = [
    { left: 0, top: 28, rotate: -7, z: 1 },
    { left: 78, top: 6, rotate: 2, z: 2 },
    { left: 156, top: 32, rotate: 8, z: 1 },
  ];

  if (posters.length === 0) {
    return (
      <div className="relative ml-auto h-[250px] w-[276px]" aria-hidden>
        {positions.map((pos, index) => (
          <div
            key={index}
            className="absolute aspect-[2/3] w-[120px] rounded-xl border border-white/10 bg-gradient-to-br from-accent/15 via-chip to-pink-500/10"
            style={{ left: pos.left, top: pos.top, transform: `rotate(${pos.rotate}deg)`, zIndex: pos.z }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="relative ml-auto h-[250px] w-[276px]">
      {posters.map((item, index) => {
        const pos = positions[index] ?? positions[0];
        return (
          <HeroPosterCard
            key={item.id}
            item={item}
            onPick={onPick}
            style={{
              left: pos.left,
              top: pos.top,
              transform: `rotate(${pos.rotate}deg)`,
              zIndex: pos.z,
            }}
          />
        );
      })}
    </div>
  );
}

function HeroPosterCard({
  item,
  onPick,
  style,
}: {
  item: DoubanItem;
  onPick: (title: string) => void;
  style: CSSProperties;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [item.cover]);

  return (
    <button
      type="button"
      onClick={() => onPick(item.title)}
      aria-label={`搜索 ${item.title}`}
      className="group absolute aspect-[2/3] w-[120px] overflow-hidden rounded-xl border border-white/10 bg-chip text-left shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={style}
    >
      {item.cover && !imgFailed ? (
        <SmartImage
          url={item.cover}
          mode={imageProxyMode}
          customProxy={customImageProxy}
          alt={item.title}
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover"
          onExhausted={() => setImgFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 bg-gradient-to-br from-accent/30 via-chip to-pink-500/20" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      {item.rating && (
        <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-rating">
          ★ {item.rating}
        </span>
      )}
      <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-xs font-medium leading-snug text-white">
        {item.title}
      </span>
    </button>
  );
}

/** 首页右侧热播榜：直接复用推荐列表顺序，不额外请求 */
export function RankList({ items, onPick }: { items: DoubanItem[]; onPick: (title: string) => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  return (
    <aside aria-label="热播榜" className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-content">热播榜</h2>
        <span className="text-xs text-faint">豆瓣热度</span>
      </div>

      {items.length === 0 ? (
        <RankSkeleton />
      ) : (
        <ol className="space-y-1.5">
          {items.slice(0, 6).map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item.title)}
                className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span className="w-5 shrink-0 text-xs tabular-nums text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="relative block h-11 w-8 shrink-0 overflow-hidden rounded bg-chip">
                  <span className="absolute inset-0 bg-gradient-to-br from-accent/25 to-pink-500/20" />
                  {item.cover && (
                    <SmartImage
                      url={item.cover}
                      mode={imageProxyMode}
                      customProxy={customImageProxy}
                      alt={item.title}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-content">{item.title}</span>
                  <span className="block text-[11px] text-faint">
                    {item.rating ? `豆瓣 ${item.rating}` : item.isTv ? '剧集' : '电影'}
                    {item.year ? ` · ${item.year}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function RankSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 p-1.5">
          <span className="h-3 w-4 animate-pulse rounded bg-chip" />
          <span className="h-11 w-8 animate-pulse rounded bg-chip" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-3/4 animate-pulse rounded bg-chip" />
            <span className="block h-2.5 w-1/3 animate-pulse rounded bg-chip" />
          </span>
        </div>
      ))}
    </div>
  );
}
