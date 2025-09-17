const Ratings = (() => {
  const KEY = 'chessRating';
  const DEFAULT = 1200;

  function getRating() {
    const r = parseInt(localStorage.getItem(KEY), 10);
    return isNaN(r) ? DEFAULT : r;
  }

  function saveRating(r) {
    localStorage.setItem(KEY, Math.round(r));
  }

  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  function updateRating(result, opponentRating, k = 32) {
    const r = getRating();
    const e = expected(r, opponentRating);
    const nr = r + k * (result - e);
    saveRating(nr);
    return Math.round(nr);
  }

  async function sync(url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: getRating() })
      });
      return await res.json();
    } catch (err) {
      import('../../tools/reporters/console-signature.js').then(({ warn }) => {
        warn('chess', 'Rating sync failed', err);
      });
    }
  }

  return { getRating, saveRating, expected, updateRating, sync };
})();
