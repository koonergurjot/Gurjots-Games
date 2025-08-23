export function injectBackButton(root='../../') {
  const style = document.createElement('style');
  style.textContent = `.back{position:fixed;left:12px;bottom:12px;color:#cfe6ff;background:#0e1422;border:1px solid #27314b;padding:8px 10px;border-radius:10px;font-weight:700;text-decoration:none}`;
  document.head.appendChild(style);
  const a = document.createElement('a');
  a.href = root;
  a.className = 'back';
  a.textContent = '← Back to Hub';
  document.body.appendChild(a);
}

export function registerSW() {
  if ('serviceWorker' in navigator) {
    const url = new URL('../sw.js', import.meta.url);
    navigator.serviceWorker.register(url);
  }
}
