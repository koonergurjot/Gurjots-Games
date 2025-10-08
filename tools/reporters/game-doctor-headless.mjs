import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 8000;
const VIEWPORT = { width: 1280, height: 720 };
const LOAD_WAIT_UNTIL = 'load';

function sanitizeValue(value) {
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 500) {
      return `${trimmed.slice(0, 497)}...`;
    }
    return trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message ?? String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function sanitizeEventDetail(event = {}) {
  const detail = {};
  const keys = ['message', 'reason', 'error', 'via', 'filename', 'lineno', 'colno'];
  for (const key of keys) {
    if (event[key] != null) {
      detail[key] = sanitizeValue(event[key]);
    }
  }
  return detail;
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (primaryError) {
    try {
      return await import('playwright-core');
    } catch {
      throw primaryError;
    }
  }
}

class PlaywrightHeadlessRunner {
  constructor(browser, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.browser = browser;
    this.timeoutMs = timeoutMs;
  }

  async run(shellUrl, context = {}) {
    const runtimeContext = await this.browser.newContext({ viewport: VIEWPORT });
    let page;
    try {
      page = await runtimeContext.newPage();
      await page.addInitScript(({ timeoutMs }) => {
        const signals = [];
        let resolved = false;
        let resolvePromise;
        const resultPromise = new Promise((resolve) => {
          resolvePromise = resolve;
        });
        function finish(status, detail = {}) {
          if (resolved) {
            return;
          }
          resolved = true;
          clearTimeout(timer);
          const payload = { status, details: { ...detail } };
          if (!Array.isArray(payload.details.signals)) {
            payload.details.signals = signals.slice();
          }
          resolvePromise(payload);
        }
        const timer = setTimeout(() => {
          finish('timeout', { waitedMs: timeoutMs });
        }, timeoutMs);
        function recordSignal(type, data) {
          try {
            signals.push({ type, data: data ? JSON.parse(JSON.stringify(data)) : null });
          } catch {
            signals.push({ type, data: sanitizeValue(data) });
          }
        }
        const parentBridge = {
          postMessage(message) {
            recordSignal('postMessage', message);
            if (message && typeof message === 'object' && typeof message.type === 'string') {
              if (message.type === 'GAME_READY') {
                finish('ready', { message });
                return;
              }
              if (message.type === 'GAME_ERROR') {
                finish('error', { message, via: 'postMessage' });
                return;
              }
            }
          },
        };
        try {
          Object.defineProperty(window, 'parent', { value: parentBridge, configurable: true });
        } catch {
          window.parent = parentBridge;
        }
        try {
          Object.defineProperty(window, 'top', { value: window, configurable: true });
        } catch {
          window.top = window;
        }
        try {
          Object.defineProperty(window, 'frameElement', { value: null, configurable: true });
        } catch {
          window.frameElement = null;
        }
        window.addEventListener('error', (event) => {
          const detail = sanitizeEventDetail({
            message: event?.message,
            filename: event?.filename,
            lineno: event?.lineno,
            colno: event?.colno,
            error: event?.error,
            via: 'window-error',
          });
          finish('error', { event: detail });
        });
        window.addEventListener('unhandledrejection', (event) => {
          const detail = sanitizeEventDetail({
            reason: event?.reason,
            via: 'unhandledrejection',
          });
          finish('error', { event: detail });
        });
        window.__gameDoctorWaitForReady = () => resultPromise;
      }, { timeoutMs: this.timeoutMs });

      await page.goto(shellUrl, { waitUntil: LOAD_WAIT_UNTIL, timeout: this.timeoutMs });
      const result = await page.evaluate(() => {
        return typeof window.__gameDoctorWaitForReady === 'function'
          ? window.__gameDoctorWaitForReady()
          : { status: 'failed', details: { message: 'Headless harness missing wait function' } };
      });
      if (result && typeof result === 'object') {
        return sanitizeRunResult(result, context);
      }
      return sanitizeRunResult({ status: 'failed', details: { message: 'Headless harness returned no result' } }, context);
    } catch (error) {
      return sanitizeRunResult({ status: 'exception', details: { error: sanitizeValue(error) } }, context);
    } finally {
      await runtimeContext.close();
    }
  }

  async close() {
    await this.browser.close();
  }
}

function sanitizeRunResult(result, context) {
  const details = result?.details ?? {};
  const sanitized = {
    status: result?.status ?? 'unknown',
    details: {
      slug: context.slug ?? null,
      shell: context.shellPath ?? null,
    },
  };
  if (details.waitedMs != null) {
    sanitized.details.waitedMs = details.waitedMs;
  }
  if (details.message != null) {
    sanitized.details.message = sanitizeValue(details.message);
  }
  if (details.error != null) {
    sanitized.details.error = sanitizeValue(details.error);
  }
  if (details.event != null) {
    sanitized.details.event = sanitizeEventDetail(details.event);
  }
  if (Array.isArray(details.signals) && details.signals.length > 0) {
    sanitized.details.signals = details.signals.map((entry) => {
      const item = { type: entry?.type ?? 'signal' };
      if (entry?.data && typeof entry.data === 'object') {
        const signal = {};
        if (typeof entry.data.type === 'string') {
          signal.type = entry.data.type;
        }
        sanitizedAssign(signal, entry.data, ['slug', 'synthetic']);
        if (Object.keys(signal).length > 0) {
          item.data = signal;
        }
      }
      return item;
    });
  }
  return sanitized;
}

function sanitizedAssign(target, source, keys) {
  for (const key of keys) {
    if (source[key] != null) {
      target[key] = sanitizeValue(source[key]);
    }
  }
}

export async function createHeadlessRunner(options = {}) {
  const playwright = await importPlaywright();
  if (!playwright?.chromium) {
    throw new Error('Playwright chromium browser unavailable');
  }
  const browser = await playwright.chromium.launch({ headless: true });
  return new PlaywrightHeadlessRunner(browser, options);
}

export function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}
