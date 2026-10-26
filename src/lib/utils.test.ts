import { describe, expect, it } from 'vitest';
import { buildImageCandidates, buildImageUrl, matchesFuzzy } from './utils';

describe('buildImageUrl', () => {
  it('proxy 模式走查询串形式（路径形式会被 EdgeOne 等网关归一化破坏）', () => {
    expect(buildImageUrl('https://img3.doubanio.com/a.jpg', 'proxy', '')).toBe(
      '/api/proxy?url=' + encodeURIComponent('https://img3.doubanio.com/a.jpg')
    );
  });

  it('direct 与 custom 模式', () => {
    expect(buildImageUrl('https://x.com/a.jpg', 'direct', '')).toBe('https://x.com/a.jpg');
    expect(buildImageUrl('https://x.com/a.jpg', 'custom', 'https://p.example.com/?u=')).toBe(
      'https://p.example.com/?u=' + encodeURIComponent('https://x.com/a.jpg')
    );
    expect(buildImageUrl(undefined, 'proxy', '')).toBeUndefined();
  });
});

describe('buildImageCandidates', () => {
  const DOUBAN = 'https://img3.doubanio.com/view/photo/m/poster.jpg';

  it('direct 模式豆瓣图：直连 → 双镜像 → 内置代理', () => {
    expect(buildImageCandidates(DOUBAN, 'direct', '')).toEqual([
      DOUBAN,
      'https://img.doubanio.cmliussss.net/view/photo/m/poster.jpg',
      'https://img.doubanio.cmliussss.com/view/photo/m/poster.jpg',
      '/api/proxy?url=' + encodeURIComponent(DOUBAN),
    ]);
  });

  it('direct 模式非豆瓣图：直连 → 内置代理（无镜像候选）', () => {
    expect(buildImageCandidates('https://bdstatic.com/x.jpg', 'direct', '')).toEqual([
      'https://bdstatic.com/x.jpg',
      '/api/proxy?url=' + encodeURIComponent('https://bdstatic.com/x.jpg'),
    ]);
  });

  it('镜像改写不命中 img\\d+ 子域时去重，不产生重复候选', () => {
    const cands = buildImageCandidates('https://doubanio.com/a.jpg', 'direct', '');
    expect(new Set(cands).size).toBe(cands.length);
    expect(cands[0]).toBe('https://doubanio.com/a.jpg');
  });

  it('proxy 模式豆瓣图：内置代理 → 双镜像 → 直连（代理故障可回退）', () => {
    expect(buildImageCandidates(DOUBAN, 'proxy', '')).toEqual([
      '/api/proxy?url=' + encodeURIComponent(DOUBAN),
      'https://img.doubanio.cmliussss.net/view/photo/m/poster.jpg',
      'https://img.doubanio.cmliussss.com/view/photo/m/poster.jpg',
      DOUBAN,
    ]);
  });

  it('proxy 模式非豆瓣图：内置代理 → 直连', () => {
    expect(buildImageCandidates('https://bdstatic.com/x.jpg', 'proxy', '')).toEqual([
      '/api/proxy?url=' + encodeURIComponent('https://bdstatic.com/x.jpg'),
      'https://bdstatic.com/x.jpg',
    ]);
  });

  it('custom 模式为单一候选（模板错误显式暴露，不静默回退）', () => {
    expect(buildImageCandidates(DOUBAN, 'custom', 'https://p.example.com/?u=')).toHaveLength(1);
    expect(buildImageCandidates(undefined, 'direct', '')).toEqual([]);
  });
});

describe('matchesFuzzy', () => {
  it('按顺序包含全部字符即命中（允许跳字）', () => {
    expect(matchesFuzzy('流浪的地球', '流地')).toBe(true);
    expect(matchesFuzzy('流浪地球', '流地')).toBe(true);
    expect(matchesFuzzy('流星的球', '流地')).toBe(false);
  });

  it('单字符与含数字的关键词不启用', () => {
    expect(matchesFuzzy('流浪地球', '流')).toBe(false);
    expect(matchesFuzzy('钢铁侠12008', '钢铁侠2008')).toBe(false);
  });

  it('关键词比标题长时不命中', () => {
    expect(matchesFuzzy('流浪', '流浪地球')).toBe(false);
  });
});
