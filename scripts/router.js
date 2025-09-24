import { getBasePath, isWithinBasePath, resolveRoutePath, stripBasePath } from '../shared/base-path.js';

export class Router {
  constructor(outlet, basePath = getBasePath()) {
    this.outlet = outlet;
    this.routes = [];
    this.basePath = basePath;
    window.addEventListener('popstate', () => this.resolve(location.pathname));
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || !(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== '_self') return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (!isWithinBasePath(url.pathname)) return;
      e.preventDefault();
      const fullPath = `${url.pathname}${url.search || ''}`;
      this.navigate(fullPath);
    });
  }

  register(path, loader, guard) {
    const keys = [];
    const pattern = new RegExp('^' + path.replace(/:([^/]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    }) + '$');
    this.routes.push({ pattern, keys, loader, guard });
  }

  async navigate(path) {
    const target = resolveRoutePath(path);
    history.pushState({}, '', target);
    await this.resolve(target);
  }

  async resolve(path) {
    const normalizedPath = stripBasePath(path);
    const [pathOnly] = normalizedPath.split('?');
    const candidatePath = pathOnly || '/';
    for (const r of this.routes) {
      const match = r.pattern.exec(candidatePath);
      if (match) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = decodeURIComponent(match[i + 1]));
        if (r.guard && !(await r.guard(params))) {
          const fallback = resolveRoutePath('/');
          history.replaceState({}, '', fallback);
          return this.resolve(fallback);
        }
        const mod = await r.loader(params);
        this.outlet.innerHTML = '';
        if (typeof mod.default === 'function') {
          mod.default(this.outlet, params);
        }
        return;
      }
    }
    const mod = await import('./pages/not-found.js');
    this.outlet.innerHTML = '';
    mod.default(this.outlet);
  }
}

export function createRouter(outlet, basePath) {
  return new Router(outlet, basePath);
}
