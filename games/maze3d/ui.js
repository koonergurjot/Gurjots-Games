const BEST_TIMES_KEY = 'maze3d:seedBestTimes';
let bestTimeCache = null;

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function loadBestTimeCache() {
  if (bestTimeCache) return bestTimeCache;
  if (typeof localStorage === 'undefined') {
    bestTimeCache = {};
    return bestTimeCache;
  }
  try {
    const raw = localStorage.getItem(BEST_TIMES_KEY);
    if (!raw) {
      bestTimeCache = {};
      return bestTimeCache;
    }
    const parsed = JSON.parse(raw);
    bestTimeCache = isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    bestTimeCache = {};
  }
  return bestTimeCache;
}

function saveBestTimeCache() {
  if (!bestTimeCache) return;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BEST_TIMES_KEY, JSON.stringify(bestTimeCache));
  } catch (err) {
    // ignore storage failures
  }
}

export function getBestTimeForSeed(seedKey) {
  if (typeof seedKey !== 'string' || !seedKey) return null;
  const cache = loadBestTimeCache();
  const value = cache?.[seedKey];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function setBestTimeForSeed(seedKey, seconds) {
  if (typeof seedKey !== 'string' || !seedKey) return null;
  const normalized = Number(seconds);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  const cache = loadBestTimeCache();
  cache[seedKey] = Number(normalized.toFixed(3));
  saveBestTimeCache();
  return cache[seedKey];
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0.00';
  return seconds.toFixed(2);
}

function headingToLabel(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(normalized / 45) % directions.length;
  return directions[index];
}

export function createCompassUi() {
  if (typeof document === 'undefined') return null;
  let container = document.getElementById('mazeCompass');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mazeCompass';
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.bottom = '228px';
    container.style.width = '88px';
    container.style.height = '88px';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.background = 'rgba(15,23,42,0.55)';
    container.style.border = '1px solid rgba(148,163,184,0.45)';
    container.style.borderRadius = '50%';
    container.style.boxShadow = '0 10px 25px rgba(15,23,42,0.35)';
    container.style.backdropFilter = 'blur(6px)';
    container.style.pointerEvents = 'none';
    container.style.color = '#f8fafc';
    container.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    document.body?.appendChild(container);
  }

  let dial = container.querySelector('[data-role="dial"]');
  if (!dial) {
    dial = document.createElement('div');
    dial.dataset.role = 'dial';
    dial.style.position = 'relative';
    dial.style.width = '70px';
    dial.style.height = '70px';
    dial.style.borderRadius = '50%';
    dial.style.border = '2px solid rgba(148,163,184,0.45)';
    dial.style.display = 'flex';
    dial.style.alignItems = 'center';
    dial.style.justifyContent = 'center';
    dial.style.background = 'rgba(15,23,42,0.8)';
    container.appendChild(dial);
  }

  let needle = dial.querySelector('[data-role="needle"]');
  if (!needle) {
    needle = document.createElement('div');
    needle.dataset.role = 'needle';
    needle.style.position = 'absolute';
    needle.style.left = '50%';
    needle.style.top = '10px';
    needle.style.width = '4px';
    needle.style.height = '28px';
    needle.style.marginLeft = '-2px';
    needle.style.borderRadius = '4px';
    needle.style.background = 'linear-gradient(180deg, #f97316 0%, #fb923c 70%, rgba(251,146,60,0.2) 100%)';
    needle.style.boxShadow = '0 0 14px rgba(249,115,22,0.55)';
    needle.style.transformOrigin = '50% 90%';
    needle.style.transform = 'rotate(0deg)';
    dial.appendChild(needle);
  }

  let label = container.querySelector('[data-role="heading"]');
  if (!label) {
    label = document.createElement('div');
    label.dataset.role = 'heading';
    label.style.position = 'absolute';
    label.style.bottom = '8px';
    label.style.width = '100%';
    label.style.textAlign = 'center';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    container.appendChild(label);
  }

  return { container, needle, label };
}

export function updateCompassHeading(compass, headingDeg) {
  if (!compass || !compass.needle) return;
  const normalized = Number.isFinite(headingDeg) ? headingDeg : 0;
  compass.needle.style.transform = `rotate(${normalized}deg)`;
  if (compass.label) {
    compass.label.textContent = headingToLabel(normalized);
  }
}

export function setCompassVisible(compass, visible) {
  if (!compass || !compass.container) return;
  compass.container.style.display = visible ? 'flex' : 'none';
}
