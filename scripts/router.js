export class Router {
  constructor(outlet) {
    this.outlet = outlet;
    this.routes = [];
    window.addEventListener('popstate', () => this.resolve(location.pathname));
    document.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (a && a instanceof HTMLAnchorElement && a.origin === location.origin) {
        const href = a.getAttribute('href');
        if (href && href.startsWith('/')) {
          e.preventDefault();
          this.navigate(href);
        }
      }
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
    history.pushState({}, '', path);
    await this.resolve(path);
  }

  async resolve(path) {
    for (const r of this.routes) {
      const match = r.pattern.exec(path);
      if (match) {
        const params = {};
        r.keys.forEach((k, i) => params[k] = decodeURIComponent(match[i + 1]));
        if (r.guard && !(await r.guard(params))) {
          history.replaceState({}, '', '/');
          return this.resolve('/');
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

export function createRouter(outlet) {
  return new Router(outlet);
}
