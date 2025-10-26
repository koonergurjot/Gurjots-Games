/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getLocalLeaderboard } from '../shared/ui.js';

describe('getLocalLeaderboard', () => {
  beforeEach(() => localStorage.clear());
  it('returns sorted valid entries', () => {
    localStorage.setItem('leaderboard:pong', JSON.stringify([
      { name: 'A', score: 5 },
      { name: 'B', score: 12 },
      { name: 'C', score: 7 },
      { name: 'D', score: 'x' }
    ]));
    expect(getLocalLeaderboard('pong')).toEqual([
      { name: 'B', score: 12 },
      { name: 'C', score: 7 },
      { name: 'A', score: 5 }
    ]);
  });
  it('handles missing or invalid data', () => {
    expect(getLocalLeaderboard('pong')).toEqual([]);
    localStorage.setItem('leaderboard:pong', 'not-json');
    expect(getLocalLeaderboard('pong')).toEqual([]);
  });
});

describe('shared/leaderboard client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    delete window.LB;
    delete window.__leaderboard;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
    delete window.LB;
    delete window.__leaderboard;
  });

  async function loadClient(){
    await import('../shared/leaderboard.js');
    return window.LB;
  }

  it('submits scores via the API and updates the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ submitted: { score: 42 } })
    });
    global.fetch = fetchMock;
    const clientPromise = await loadClient();
    const client = await clientPromise;
    const result = await client.submitScore('pong', 42);
    expect(fetchMock).toHaveBeenCalledWith('/api/leaderboard', expect.objectContaining({
      method: 'POST'
    }));
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.fromCache).toBe(false);
    const cached = JSON.parse(localStorage.getItem('leaderboard:pong'));
    expect(cached[0].score).toBe(42);
  });

  it('falls back to cached scores when the fetch call fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ submitted: { score: 7 } })
      })
      .mockRejectedValueOnce(new TypeError('network down'));
    global.fetch = fetchMock;
    const clientPromise = await loadClient();
    const client = await clientPromise;
    await client.submitScore('pong', 7);
    const result = await client.getTopScores('pong', null, 5);
    expect(result.fromCache).toBe(true);
    expect(result.entries[0].score).toBe(7);
  });

  it('throws LeaderboardError when submission fails but keeps the local score', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' })
    });
    global.fetch = fetchMock;
    const clientPromise = await loadClient();
    const client = await clientPromise;
    await expect(client.submitScore('pong', 9)).rejects.toBeInstanceOf(client.LeaderboardError);
    const cached = JSON.parse(localStorage.getItem('leaderboard:pong'));
    expect(cached[0].score).toBe(9);
  });
});
