import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const nativeWindow = global.window;
const nativeDocument = global.document;

describe('diag-autowire guard', () => {
  let dom;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.window.__GG_DIAG = { log: () => {} };
    const marker = dom.window.document.createElement('script');
    marker.id = 'gg-diag-autowire';
    dom.window.document.head.appendChild(marker);
    await import('../games/common/diag-autowire.js');
  });

  afterEach(() => {
    if (nativeWindow === undefined) {
      delete global.window;
    } else {
      global.window = nativeWindow;
    }

    if (nativeDocument === undefined) {
      delete global.document;
    } else {
      global.document = nativeDocument;
    }

    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  it('does not append diag-capture when diagnostics are already active', () => {
    const scripts = dom.window.document.querySelectorAll('script[data-gg-diag-capture]');
    expect(scripts.length).toBe(0);
  });
});
