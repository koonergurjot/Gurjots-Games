// shared/skins/index.js
// Expose CSS token values defined in styles/tokens.css.

function ensureTokensCss(){
  if (typeof document === 'undefined') return;
  if (document.head.querySelector('link[data-theme-tokens]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../styles/tokens.css', import.meta.url).href;
  link.setAttribute('data-theme-tokens', '');
  document.head.appendChild(link);
}

export function getThemeTokens(theme){
  if (typeof document === 'undefined') return {};
  ensureTokensCss();
  const root = document.documentElement;
  const prev = root.dataset.theme;
  if (theme) root.dataset.theme = theme;
  const styles = getComputedStyle(root);
  const tokens = {};
  for (let i = 0; i < styles.length; i++) {
    const prop = styles[i];
    if (prop.startsWith('--')) {
      tokens[prop.slice(2)] = styles.getPropertyValue(prop).trim();
    }
  }
  if (theme) root.dataset.theme = prev;
  return tokens;
}

export default getThemeTokens;
