import { describe, it, expect, beforeEach, vi } from 'vitest';
import makeServiceWorkerEnv from 'service-worker-mock';

const SW_SCOPE = 'tests';
const CACHE_NAME = `gg-v3_3-${SW_SCOPE}`;

describe('service worker cache management', () => {
  beforeEach(() => {
    Object.assign(global, makeServiceWorkerEnv());
    self.registration = { scope: SW_SCOPE };
    self.clients = {
      claim: () => Promise.resolve(),
    };
    self.__PRECACHE_MANIFEST = ['/games/asteroids/index.html'];
    self.importScripts = () => {};
    self.fetch = global.fetch = vi.fn(() => Promise.resolve(new Response('ok')));
  });

  it('removes outdated caches on activate', async () => {
    await caches.open('gg-old');
    await caches.open('unused-cache');
    await caches.open(CACHE_NAME);

    await import('../sw.js?cache-bust=' + Date.now());

    await self.trigger('activate');

    const keys = await caches.keys();
    expect(keys).toEqual([CACHE_NAME]);
  });

  it('pre-caches manifest assets on install', async () => {
    await import('../sw.js?cache-bust=' + Date.now());
    await self.trigger('install');
    const cached = await caches.match('/index.html');
    expect(cached).toBeDefined();
    const manifestAsset = await caches.match('/games/asteroids/index.html');
    expect(manifestAsset).toBeDefined();
  });

  it('caches assets requested through PRECACHE messages', async () => {
    await import('../sw.js?cache-bust=' + Date.now());
    await self.trigger('install');
    const fetchMock = global.fetch;

    await self.trigger('message', { data: { type: 'PRECACHE', assets: ['/games/demo/index.html', '/games/demo/index.html'] } });
    await new Promise((resolve) => setImmediate(resolve));

    const matchingCalls = fetchMock.mock.calls.filter(([url]) => url === '/games/demo/index.html');
    expect(matchingCalls).toHaveLength(1);
    expect(matchingCalls[0][1]).toEqual({ credentials: 'omit' });
    const cached = await caches.match('/games/demo/index.html');
    expect(cached).toBeDefined();
  });

  // NOTE: Add broader smoke fixtures if we expand offline routing coverage.
});
