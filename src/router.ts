export type Params = Record<string, string>;
export type Loader = (params: Params) => Promise<{ default: (el: HTMLElement, params: Params) => void }>;
export type Guard = (params: Params) => Promise<boolean> | boolean;

interface Route {
  pattern: RegExp;
  keys: string[];
  loader: Loader;
  guard?: Guard;
}

export class Router {
  private routes: Route[] = [];
  private outlet: HTMLElement;

  constructor(outlet: HTMLElement) {
    this.outlet = outlet;
    window.addEventListener('popstate', () => this.resolve(location.pathname));
    document.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('a');
      if (a && a instanceof HTMLAnchorElement && a.origin === location.origin) {
        const href = a.getAttribute('href');
        if (href && href.startsWith('/')) {
          e.preventDefault();
          this.navigate(href);
        }
      }
    });
  }

  register(path: string, loader: Loader, guard?: Guard) {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:([^/]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    }) + '$');
    this.routes.push({ pattern, keys, loader, guard });
  }

  async navigate(path: string) {
    history.pushState({}, '', path);
    await this.resolve(path);
  }

  async resolve(path: string) {
    for (const r of this.routes) {
      const match = r.pattern.exec(path);
      if (match) {
        const params: Params = {};
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

export function createRouter(outlet: HTMLElement) {
  return new Router(outlet);
}
