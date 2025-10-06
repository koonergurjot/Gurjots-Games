import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeNavigator = global.navigator;
const nativeDocument = global.document;
const nativePerformance = global.performance;
const nativeAddEventListener = global.addEventListener;
const nativeDispatchEvent = global.dispatchEvent;

describe('diag-capture opt-out flag', () => {
  let listeners;

  beforeEach(() => {
    vi.resetModules();

    listeners = new Map();

    global.addEventListener = vi.fn((type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    });

    global.dispatchEvent = (event) => {
      const handlers = listeners.get(event?.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
      return true;
    };

    const serviceWorkerRegistration = {
      scope: '/test/',
      active: { state: 'activated' },
      installing: null,
      waiting: null,
    };

    global.performance = {
      now: () => 0,
      getEntriesByType: () => [],
      timing: {},
      memory: null,
    };

    global.navigator = {
      userAgent: 'test-agent',
      language: 'en-US',
      platform: 'test-platform',
      hardwareConcurrency: 4,
      deviceMemory: 2,
      onLine: true,
      serviceWorker: {
        ready: Promise.resolve(serviceWorkerRegistration),
        getRegistrations: () => Promise.resolve([serviceWorkerRegistration]),
        controller: { state: 'activated' },
      },
    };

    global.document = { visibilityState: 'visible' };
    global.__GG_DIAG_QUEUE = [];
  });

  afterEach(() => {
    if (nativePerformance === undefined) {
      delete global.performance;
    } else {
      global.performance = nativePerformance;
    }

    if (nativeNavigator === undefined) {
      delete global.navigator;
    } else {
      global.navigator = nativeNavigator;
    }

    if (nativeDocument === undefined) {
      delete global.document;
    } else {
      global.document = nativeDocument;
    }

    if (nativeAddEventListener === undefined) {
      delete global.addEventListener;
    } else {
      global.addEventListener = nativeAddEventListener;
    }

    if (nativeDispatchEvent === undefined) {
      delete global.dispatchEvent;
    } else {
      global.dispatchEvent = nativeDispatchEvent;
    }

    delete global.__GG_DIAG_QUEUE;
    delete global.__GG_DIAG;
    delete global.__GG_DIAG_PUSH_EVENT__;
    delete global.__DIAG_CAPTURE_READY;
    delete global.__DIAG_NO_MONKEYPATCH__;
  });

  it('does not patch console or fetch when __DIAG_NO_MONKEYPATCH__ is truthy', async () => {
    const originalConsoleLog = global.console?.log;
    const originalConsoleError = global.console?.error;
    const originalFetch = global.fetch;

    global.__DIAG_NO_MONKEYPATCH__ = true;

    await import('../games/common/diag-capture.js');

    expect(global.console?.log).toBe(originalConsoleLog);
    expect(global.console?.error).toBe(originalConsoleError);
    expect(global.fetch).toBe(originalFetch);
    expect(global.__DIAG_CAPTURE_READY).toBe(true);
    expect(global.__GG_DIAG_PUSH_EVENT__).toBeTypeOf('function');

    const dispatch = (type, event = {}) => {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler(event));
    };

    dispatch('error', {
      message: 'Test error',
      filename: 'test.js',
      lineno: 1,
      colno: 2,
      error: new Error('boom'),
      target: global,
    });

    dispatch('online');
    dispatch('offline');

    expect(global.__GG_DIAG_QUEUE.some((entry) => entry.category === 'error' && entry.message === 'Test error')).toBe(true);
    expect(global.__GG_DIAG_QUEUE.some((entry) => entry.category === 'heartbeat')).toBe(true);
    expect(global.__GG_DIAG_QUEUE.filter((entry) => entry.category === 'network' && /navigator\.online/.test(entry.message))).toHaveLength(2);
  });
});
