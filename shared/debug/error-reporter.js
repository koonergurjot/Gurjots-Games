// shared/debug/error-reporter.js
// Basic error logging utility. Sends errors to an endpoint or console.

export function installErrorReporter(endpoint){
  function send(type, payload){
    if (!endpoint){
      console.error(type, payload);
      return;
    }
    try {
      navigator.sendBeacon(endpoint, JSON.stringify({ type, ...payload }));
    } catch {
      try {
        fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ type, ...payload }),
          headers: { 'content-type': 'application/json' },
          keepalive: true
        });
      } catch {}
    }
  }
  window.addEventListener('error', e => {
    send('error', { message: e.error?.message || e.message, stack: e.error?.stack });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    send('unhandledrejection', { message: r?.message || String(r), stack: r?.stack });
  });
}
