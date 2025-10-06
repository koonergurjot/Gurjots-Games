import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeNavigator = global.navigator;
const nativeDocument = global.document;
const nativePerformance = global.performance;

describe('diag-capture opt-out flag', () => {
  beforeEach(() => {
    vi.resetModules();

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
  });
});
