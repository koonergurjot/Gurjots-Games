export type Params = Record<string, string>;
export type Loader = (params: Params) => Promise<{ default: (el: HTMLElement, params: Params, context: ResolveContext) => void }>;
type ResolveMode = 'push' | 'replace' | 'pop';

export interface ResolveContext {
  mode: ResolveMode;
  visited: Set<string>;
  url: URL;
  path: string;
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
    window.addEventListener('popstate', () =>
      this.resolve(this.buildFullPath(location.pathname + location.search + location.hash), {
        mode: 'pop',
        visited: new Set(),
      })
    );
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
    const { url, fullPath } = this.parsePath(path);
    const resolveContext: ResolveContext = {
      mode: context?.mode ?? 'pop',
      visited: context?.visited ?? new Set<string>(),
      url,
      path: fullPath,
    };

    if (resolveContext.visited.has(fullPath)) {
      await this.renderNotFound(fullPath, resolveContext);
      return;
    }

    resolveContext.visited.add(fullPath);

    const match = this.match(url.pathname);
    if (!match) {
      await this.renderNotFound(fullPath, resolveContext);
      return;
    }

    const { route, params } = match;
    let guardResult: boolean | string = true;
    if (route.guard) {
      guardResult = await route.guard(params, resolveContext);
    }

    if (guardResult === true) {
      await this.renderRoute(route, params, resolveContext);
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

    await this.renderNotFound(fullPath, resolveContext);
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

  private async renderRoute(route: Route, params: Params, context: ResolveContext) {
    let mod;
    try {
      mod = await route.loader(params);
    } catch (error) {
      console.error('Failed to load route module', { error, route: route.pattern, params });
      await this.renderNotFound(context.path, context, { commitHistory: false });
      return;
    }

    this.outlet.innerHTML = '';
    if (typeof mod.default === 'function') {
      mod.default(this.outlet, params, context);
    }
    this.commitHistory(context.path, context.mode);
  }

  private async renderNotFound(path: string, context: ResolveContext, options?: { commitHistory?: boolean }) {
    const mod = await import('../scripts/pages/not-found.js');
    this.outlet.innerHTML = '';
    mod.default(this.outlet);
    if (options?.commitHistory ?? true) {
      this.commitHistory(path, context.mode);
    }
  }

  private commitHistory(path: string, mode: ResolveMode) {
    const current = this.buildFullPath(location.pathname + location.search + location.hash);
    if (mode === 'push') {
      if (path !== current) {
        history.pushState({}, '', path);
      }
    } else if (mode === 'replace') {
      history.replaceState({}, '', path);
    }
  }

  private parsePath(input: string) {
    let target = input || '/';
    if (!target.startsWith('/')) {
      const trimmed = target.replace(/^#+/, '');
      target = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }
    const url = new URL(target, location.origin);
    const fullPath = this.buildFullPath(url.pathname + url.search + url.hash);
    return { url, fullPath };
  }

  private buildFullPath(path: string) {
    return path || '/';
  }
}

export function createRouter(outlet: HTMLElement) {
  return new Router(outlet);
}
