import { describe, it, expect, beforeEach } from 'vitest';
import makeServiceWorkerEnv from 'service-worker-mock';

const CACHE_VERSION = 'fresh-v1';
const PRECACHE = `precache-${CACHE_VERSION}`;
const RUNTIME = `runtime-${CACHE_VERSION}`;

describe('service worker cache management', () => {
  beforeEach(() => {
    const env = makeServiceWorkerEnv();
    delete env.navigator;
    Object.assign(global, env);
    self.clients = {
      claim: () => Promise.resolve(),
    };
  });

  it('removes outdated caches on activate', async () => {
    // populate with old caches
    await caches.open('precache-old');
    await caches.open('runtime-old');
    await caches.open('unused-cache');
    // open current caches
    await caches.open(PRECACHE);
    await caches.open(RUNTIME);

    // import service worker to register listeners
    await import('../sw.js?cache-bust=' + Date.now());

    // trigger activation and wait for cleanup
    await self.trigger('activate');

    const keys = await caches.keys();
    expect(keys.sort()).toEqual([PRECACHE, RUNTIME].sort());
  });
});
