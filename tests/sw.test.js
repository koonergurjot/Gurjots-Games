import { describe, it, expect, beforeEach } from 'vitest';
import makeServiceWorkerEnv from 'service-worker-mock';

const CURRENT_CACHE = 'static-v2';

describe('service worker cache management', () => {
  beforeEach(() => {
    Object.assign(global, makeServiceWorkerEnv());
    self.clients = {
      claim: () => Promise.resolve(),
    };
  });

  it('removes outdated caches on activate', async () => {
    // populate with old caches
    await caches.open('static');
    await caches.open('old-cache');
    // open current cache
    await caches.open(CURRENT_CACHE);

    // import service worker to register listeners
    await import('../sw.js?cache-bust=' + Date.now());

    // trigger activation and wait for cleanup
    await self.trigger('activate');

    const keys = await caches.keys();
    expect(keys).toEqual([CURRENT_CACHE]);
  });
});
