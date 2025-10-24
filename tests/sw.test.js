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

  it('stages catalog assets into install essentials and warmup queue', async () => {
    const catalog = [
      {
        playUrl: '/games/foo/index.html',
        firstFrame: '/games/foo/thumb.png',
        assets: {
          sprites: ['/games/foo/sprite.png'],
          audio: ['/games/foo/theme.mp3'],
        },
        firstFrameAssets: {
          videos: ['/games/foo/intro.mp4'],
        },
      },
    ];

    const fetchMock = global.fetch;
    fetchMock.mockImplementation((request) => {
      const url = typeof request === 'string' ? request : request.url;
      if (url === '/games.json') {
        return Promise.resolve(new Response(JSON.stringify(catalog), { status: 200 }));
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });

    await import('../sw.js?cache-bust=' + Date.now());
    await self.trigger('install');

    const absolute = (path) => new URL(path, self.location.origin).href;

    expect(await caches.match(absolute('/games/foo/index.html'))).toBeDefined();
    expect(await caches.match(absolute('/games/foo/thumb.png'))).toBeDefined();
    expect(await caches.match(absolute('/games/foo/sprite.png'))).toBeDefined();
    expect(await caches.match(absolute('/games/foo/theme.mp3'))).toBeNull();
    expect(await caches.match(absolute('/games/foo/intro.mp4'))).toBeNull();

    await self.trigger('activate');
    await new Promise((resolve) => setImmediate(resolve));

    expect(await caches.match(absolute('/games/foo/theme.mp3'))).toBeDefined();
    expect(await caches.match(absolute('/games/foo/intro.mp4'))).toBeDefined();
  });

  it('queues curated warmup batches via background messages', async () => {
    await import('../sw.js?cache-bust=' + Date.now());
    await self.trigger('install');

    const fetchMock = global.fetch;
    fetchMock.mockClear();
    fetchMock.mockImplementation((request) => {
      const url = typeof request === 'string' ? request : request.url;
      return Promise.resolve(new Response(`ok:${url}`, { status: 200 }));
    });

    await self.trigger('message', {
      data: {
        type: 'BACKGROUND_WARMUP',
        assets: ['/assets/a.png', '/assets/b.png', '/assets/c.png'],
        chunkSize: 2,
        maxAssets: 2,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const firstBatch = fetchMock.mock.calls.map(([req]) => (typeof req === 'string' ? req : req.url));
    expect(firstBatch.filter((url) => url.includes('/assets/'))).toHaveLength(2);

    fetchMock.mockClear();

    await self.trigger('message', {
      data: {
        type: 'BACKGROUND_WARMUP',
        assets: ['/assets/a.png', '/assets/c.png'],
        chunkSize: 1,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const secondBatch = fetchMock.mock.calls.map(([req]) => (typeof req === 'string' ? req : req.url));
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]).toContain('/assets/c.png');
  });

  // NOTE: Add broader smoke fixtures if we expand offline routing coverage.
});
