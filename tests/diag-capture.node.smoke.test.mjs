import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const nativeNavigator = global.navigator;
const nativeSetInterval = global.setInterval;
const nativeFetch = global.fetch;

function restoreNavigator() {
  if (nativeNavigator === undefined) {
    delete global.navigator;
  } else {
    global.navigator = nativeNavigator;
  }
}

describe('diag-capture Node require smoke test', () => {
  beforeEach(() => {
    vi.resetModules();
    restoreNavigator();
    global.setInterval = nativeSetInterval;
    global.fetch = nativeFetch;
    delete global.__GG_DIAG_QUEUE;
    delete global.__GG_DIAG;
    delete global.__GG_DIAG_PUSH_EVENT__;
    delete global.__DIAG_CAPTURE_READY;
  });

  afterEach(() => {
    restoreNavigator();
    global.setInterval = nativeSetInterval;
    global.fetch = nativeFetch;
    delete global.__GG_DIAG_QUEUE;
    delete global.__GG_DIAG;
    delete global.__GG_DIAG_PUSH_EVENT__;
    delete global.__DIAG_CAPTURE_READY;
  });

  it('allows requiring diag-capture without a navigator and exposes pushEvent', () => {
    const resolved = require.resolve('../games/common/diag-capture.js');
    delete require.cache[resolved];

    delete global.navigator;
    const setIntervalSpy = vi.fn();
    global.setInterval = setIntervalSpy;

    const mod = require('../games/common/diag-capture.js');

    expect(mod).toBeTruthy();
    const exportedPushEvent = mod?.pushEvent;
    expect(exportedPushEvent ?? global.__GG_DIAG_PUSH_EVENT__).toBeTypeOf('function');
    expect(global.__GG_DIAG_PUSH_EVENT__).toBeTypeOf('function');
    expect(setIntervalSpy).toHaveBeenCalled();

    delete require.cache[resolved];
  });
});
