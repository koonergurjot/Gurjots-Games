export function injectHeader(title){
  const header = document.createElement('header');
  header.innerHTML = `<div class="brand">🎮 <span>Arcade</span> Hub</div><div class="hint">${title}</div>`;
  document.body.prepend(header);
}

export function injectBackButton(href){
  const a = document.createElement('a');
  a.className = 'back';
  a.href = href;
  a.textContent = '← Back to Hub';
  document.body.appendChild(a);
}

