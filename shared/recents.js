export function recordLastPlayed(id) {
  const key = 'lastPlayed';
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  const updated = uniqueCap([id, ...existing]);
  localStorage.setItem(key, JSON.stringify(updated));
  return updated;
}

function uniqueCap(arr) {
  return [...new Set(arr)].slice(0, 10);
}
