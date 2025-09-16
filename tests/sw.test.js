import { describe, it, expect, beforeEach } from 'vitest';
import makeServiceWorkerEnv from 'service-worker-mock';

const SW_SCOPE = 'tests';
const CACHE_NAME = `gg-v3_2-${SW_SCOPE}`;

describe('service worker cache management', () => {
  beforeEach(() => {
    Object.assign(global, makeServiceWorkerEnv());
    self.registration = { scope: SW_SCOPE };
    self.clients = {
      claim: () => Promise.resolve(),
    };
    self.__PRECACHE_MANIFEST = ['/games/asteroids/index.html'];
    self.importScripts = () => {};
    self.fetch = global.fetch = () => Promise.resolve(new Response(''));
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
  });
});
