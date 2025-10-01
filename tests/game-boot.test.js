/* @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveQuests, getXP } from '../shared/quests.js';

vi.mock('../shared/ui.js', () => ({
  injectBackButton: vi.fn(),
  injectHelpButton: vi.fn(),
  recordLastPlayed: vi.fn()
}));

vi.mock('../shared/fallback.js', () => ({
  renderFallbackPanel: vi.fn()
}));

vi.mock('../shared/game-asset-preloader.js', () => ({
  preloadFirstFrameAssets: vi.fn()
}));

function findDateForDailyQuest(id){
  const start = new Date('2025-01-01');
  for (let i = 0; i < 365; i++){
    const d = new Date(start.getTime() + i * 86400000);
    const qs = getActiveQuests(d).daily;
    if (qs.some(q => q.id === id)) return d;
  }
  throw new Error('quest not found');
}

describe('game boot quest tracking', () => {
  const originalCurrentScript = Object.getOwnPropertyDescriptor(document, 'currentScript');

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    document.body.innerHTML = '';
    delete global.fetch;
    if (originalCurrentScript){
      Object.defineProperty(document, 'currentScript', originalCurrentScript);
    } else {
      delete document.currentScript;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
    if (originalCurrentScript){
      Object.defineProperty(document, 'currentScript', originalCurrentScript);
    } else {
      delete document.currentScript;
    }
  });

  it('increments the 3D quest when chess3d boots from raw catalog data', async () => {
    const targetDate = findDateForDailyQuest('d_play3d3');
    vi.useFakeTimers();
    vi.setSystemTime(targetDate);

    const catalog = [
      { id: 'chess3d', tags: ['3D'] },
      { id: 'runner', tags: ['endless'] }
    ];

    global.fetch = vi.fn(async url => {
      if (url === '/games.json'){
        return {
          ok: true,
          status: 200,
          async json(){
            return catalog;
          }
        };
      }
      return {
        ok: false,
        status: 404,
        async json(){
          return {};
        }
      };
    });

    const script = document.createElement('script');
    script.dataset.slug = 'chess3d';
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      value: script
    });

    await import('../shared/game-boot.js');

    await Promise.resolve();
    await Promise.resolve();

    const quest = getActiveQuests(targetDate).daily.find(q => q.id === 'd_play3d3');
    expect(quest?.progress).toBe(1);
    expect(getXP()).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith('/games.json', expect.any(Object));
  });
});

