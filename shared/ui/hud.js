// shared/ui/hud.js
// Minimal HUD utilities: toast notifications and modal dialogs.

function loadStyle(href){
  if (typeof document === 'undefined') return;
  if (!document.head.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}

const base = new URL('./', import.meta.url);
['hud.css','toast.css','modals.css'].forEach(f => {
  try { loadStyle(new URL(f, base).href); } catch {}
});

let root;
function ensureRoot(){
  if (!root) {
    root = document.createElement('div');
    root.className = 'hud';
    document.body.appendChild(root);
  }
  return root;
}

export function showToast(msg, opts = {}){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  const dur = opts.duration ?? 3000;
  ensureRoot().appendChild(el);
  setTimeout(() => el.remove(), dur);
  return el;
}

export function showModal(content, opts = {}){
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  if (typeof content === 'string') modal.innerHTML = content;
  else modal.appendChild(content);
  wrap.appendChild(modal);
  ensureRoot().appendChild(wrap);

  function close(){
    wrap.remove();
    if (opts.onClose) opts.onClose();
  }

  if (opts.closeButton !== false){
    const btn = document.createElement('button');
    btn.className = 'modal-close';
    btn.textContent = '×';
    btn.onclick = close;
    modal.appendChild(btn);
  }
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  return { element: wrap, close };
}

export function clearHud(){
  if (root) root.innerHTML = '';
}
