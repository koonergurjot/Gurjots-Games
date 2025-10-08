export type Params = Record<string, string>;
export type Loader = (params: Params) => Promise<{ default: (el: HTMLElement, params: Params) => void }>;
type ResolveMode = 'push' | 'replace' | 'pop';

export interface ResolveContext {
  mode: ResolveMode;
  visited: Set<string>;
}

export type Guard = (params: Params, context: ResolveContext) => Promise<boolean | string> | boolean | string;

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
    window.addEventListener('popstate', () => this.resolve(location.pathname, { mode: 'pop', visited: new Set() }));
    document.addEventListener('click', e => {
      if (e.defaultPrevented) {
        return;
      }
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }

      const a = target.closest('a');
      if (!a || !(a instanceof HTMLAnchorElement)) {
        return;
      }

      if (a.target && a.target !== '_self') {
        return;
      }

      if (a.hasAttribute('download')) {
        return;
      }

      const rel = a.getAttribute('rel');
      if (rel && /\bexternal\b/i.test(rel)) {
        return;
      }

      if (a.origin !== location.origin) {
        return;
      }

      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) {
        return;
      }

      e.preventDefault();
      this.navigate(href);
    });
  }

  register(path: string, loader: Loader, guard?: Guard) {
    const keys: string[] = [];
    const escapeRegExp = (segment: string) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patternSource = path
      .split(/(:[^/]+)/g)
      .map(part => {
        if (part.startsWith(':')) {
          keys.push(part.slice(1));
          return '([^/]+)';
        }
        return escapeRegExp(part);
      })
      .join('');
    const pattern = new RegExp('^' + patternSource + '$');
    this.routes.push({ pattern, keys, loader, guard });
  }

  async navigate(path: string) {
    await this.resolve(path, { mode: 'push', visited: new Set() });
  }

  async resolve(path: string, context?: Partial<ResolveContext>) {
    const resolveContext: ResolveContext = {
      mode: context?.mode ?? 'pop',
      visited: context?.visited ?? new Set<string>(),
    };

    if (resolveContext.visited.has(path)) {
      await this.renderNotFound(resolveContext.mode, path);
      return;
    }

    resolveContext.visited.add(path);

    const match = this.match(path);
    if (!match) {
      await this.renderNotFound(resolveContext.mode, path);
      return;
    }

    const { route, params } = match;
    let guardResult: boolean | string = true;
    if (route.guard) {
      guardResult = await route.guard(params, resolveContext);
    }

    if (guardResult === true) {
      await this.renderRoute(route, params);
      this.commitHistory(path, resolveContext.mode);
      return;
    }

    if (guardResult === false) {
      await this.resolve('/', { mode: 'replace', visited: resolveContext.visited });
      return;
    }

    if (typeof guardResult === 'string') {
      await this.resolve(guardResult, { mode: 'replace', visited: resolveContext.visited });
      return;
    }

    await this.renderNotFound(resolveContext.mode, path);
  }

  private match(path: string) {
    for (const route of this.routes) {
      const match = route.pattern.exec(path);
      if (!match) {
        continue;
      }
      const params: Params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });
      return { route, params };
    }
    return undefined;
  }

  private async renderRoute(route: Route, params: Params) {
    const mod = await route.loader(params);
    this.outlet.innerHTML = '';
    if (typeof mod.default === 'function') {
      mod.default(this.outlet, params);
    }
  }

  private async renderNotFound(mode: ResolveMode, path: string) {
    const mod = await import('../scripts/pages/not-found.js');
    this.outlet.innerHTML = '';
    mod.default(this.outlet);
    this.commitHistory(path, mode);
  }

  private commitHistory(path: string, mode: ResolveMode) {
    if (mode === 'push') {
      history.pushState({}, '', path);
    } else if (mode === 'replace') {
      history.replaceState({}, '', path);
    }
  }
}

export function createRouter(outlet: HTMLElement) {
  return new Router(outlet);
}
