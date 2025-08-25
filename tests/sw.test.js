import { describe, it, expect, beforeEach } from 'vitest';
import makeServiceWorkerEnv from 'service-worker-mock';

const PRECACHE = 'precache-fresh-v1';
const RUNTIME = 'runtime-fresh-v1';

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
