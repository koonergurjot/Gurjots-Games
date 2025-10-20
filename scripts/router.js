export class Router {
  constructor(outlet) {
    this.outlet = outlet;
    this.routes = [];
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

  register(path, loader, guard) {
    const keys = [];
    const escapeRegExp = segment => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  async navigate(path) {
    await this.resolve(path, { mode: 'push', visited: new Set() });
  }

  async resolve(path, context) {
    const { url, fullPath } = this.parsePath(path);
    const resolveContext = {
      mode: (context == null ? void 0 : context.mode) ?? 'pop',
      visited: (context == null ? void 0 : context.visited) ?? new Set(),
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
    let guardResult = true;
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

  match(path) {
    for (const route of this.routes) {
      const match = route.pattern.exec(path);
      if (!match) {
        continue;
      }
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });
      return { route, params };
    }
    return void 0;
  }

  async renderRoute(route, params, context) {
    const mod = await route.loader(params);
    this.outlet.innerHTML = '';
    if (typeof mod.default === 'function') {
      mod.default(this.outlet, params, context);
    }
    this.commitHistory(context.path, context.mode);
  }

  async renderNotFound(path, context) {
    const mod = await import('./pages/not-found.js');
    this.outlet.innerHTML = '';
    mod.default(this.outlet);
    this.commitHistory(path, context.mode);
  }

  commitHistory(path, mode) {
    const current = this.buildFullPath(location.pathname + location.search + location.hash);
    if (mode === 'push') {
      if (path !== current) {
        history.pushState({}, '', path);
      }
    } else if (mode === 'replace') {
      history.replaceState({}, '', path);
    }
  }

  parsePath(input) {
    let target = input || '/';
    if (!target.startsWith('/')) {
      target = '/' + target.replace(/^#+/, '');
    }
    const url = new URL(target, location.origin);
    const fullPath = this.buildFullPath(url.pathname + url.search + url.hash);
    return { url, fullPath };
  }

  buildFullPath(path) {
    return path || '/';
  }
}

export function createRouter(outlet) {
  return new Router(outlet);
}
