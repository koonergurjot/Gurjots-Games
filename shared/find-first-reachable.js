const DEFAULT_CONCURRENCY = 4;

function normalizeConcurrency(value){
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  const normalized = Math.floor(value);
  if (normalized <= 0) return 1;
  return normalized;
}

export function createFindFirstReachable({ probe, concurrency = DEFAULT_CONCURRENCY } = {}){
  if (typeof probe !== 'function'){
    throw new TypeError('createFindFirstReachable requires a probe function');
  }

  const cache = new Map();
  const maxConcurrent = normalizeConcurrency(concurrency);

  return async function findFirstReachable(slug, kind, candidates = []){
    const list = Array.from(candidates).filter(Boolean);
    if (list.length === 0) return null;

    const cacheKey = slug ? `${slug}::${kind || ''}` : null;
    if (cacheKey && cache.has(cacheKey)){
      return cache.get(cacheKey);
    }

    const controllers = new Set();

    const result = await new Promise(resolve => {
      let nextIndex = 0;
      let active = 0;
      let settled = false;
      const statuses = new Array(list.length);

      const maybeResolveNull = () => {
        if (!settled && active === 0 && nextIndex >= list.length){
          settled = true;
          resolve(null);
        }
      };

      const abortAll = () => {
        for (const controller of controllers){
          controller?.abort?.();
        }
        controllers.clear();
      };

      const maybeResolveSuccess = () => {
        if (settled) return;
        const firstSuccessIndex = statuses.findIndex(status => status === 'success');
        if (firstSuccessIndex === -1) return;
        const allEarlierResolved = statuses
          .slice(0, firstSuccessIndex)
          .every(status => status && status !== 'pending');
        if (!allEarlierResolved) return;

        settled = true;
        abortAll();
        resolve(list[firstSuccessIndex]);
      };

      const launchNext = () => {
        if (settled) return;
        while (!settled && active < maxConcurrent && nextIndex < list.length){
          const index = nextIndex++;
          const candidate = list[index];
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          if (controller) controllers.add(controller);
          active++;
          statuses[index] = 'pending';

          Promise.resolve(probe(candidate, { signal: controller?.signal, slug, kind }))
            .then(ok => {
              if (controller) controllers.delete(controller);
              active--;
              if (settled) return;
              statuses[index] = ok ? 'success' : 'failed';
              if (ok){
                maybeResolveSuccess();
                return;
              }
              launchNext();
              maybeResolveSuccess();
              maybeResolveNull();
            })
            .catch(err => {
              if (controller) controllers.delete(controller);
              active--;
              if (settled) return;
              if (err?.name === 'AbortError'){
                statuses[index] = 'aborted';
                maybeResolveSuccess();
                maybeResolveNull();
                return;
              }
              statuses[index] = 'failed';
              launchNext();
              maybeResolveSuccess();
              maybeResolveNull();
            });
        }
      };

      launchNext();
      maybeResolveNull();
    });

    if (result && cacheKey){
      cache.set(cacheKey, result);
    }

    return result;
  };
}

export default createFindFirstReachable;
