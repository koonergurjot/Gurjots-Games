import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignGlobals, restoreGlobals, snapshotGlobals } from './helpers/global-env.mjs';

// globalThis.navigator is a getter-only accessor on Node 22, so these stubs are
// installed with defineProperty and put back from their original descriptors.
const STUBBED_GLOBALS = ['navigator', 'document', 'performance', 'addEventListener', 'dispatchEvent'];

describe('diag-capture opt-out flag', () => {
  let listeners;
  let restoreEnv;

  beforeEach(() => {
    vi.resetModules();

    restoreEnv = snapshotGlobals(STUBBED_GLOBALS);

    listeners = new Map();

    const addEventListener = vi.fn((type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    });

    const dispatchEvent = (event) => {
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

    const performance = {
      now: () => 0,
      getEntriesByType: () => [],
      timing: {},
      memory: null,
    };

    const navigator = {
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

    const document = { visibilityState: 'visible' };

    assignGlobals({ addEventListener, dispatchEvent, performance, navigator, document });
    global.__GG_DIAG_QUEUE = [];
  });

  afterEach(() => {
    restoreGlobals(restoreEnv);

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
