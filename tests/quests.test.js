/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveQuests, recordPlay, getXP } from '../shared/quests.js';

function findDateForDailyQuest(id){
  const start = new Date('2025-01-01');
  for(let i=0;i<365;i++){
    const d = new Date(start.getTime() + i*86400000);
    const qs = getActiveQuests(d).daily;
    if (qs.some(q => q.id === id)) return d;
  }
  throw new Error('quest not found');
}

beforeEach(() => {
  localStorage.clear();
});

describe('quest rotation', () => {
  it('is stable for the same date', () => {
    const d = new Date('2024-05-05');
    const q1 = getActiveQuests(d);
    const q2 = getActiveQuests(d);
    expect(q1.daily.map(q=>q.id)).toEqual(q2.daily.map(q=>q.id));
    expect(q1.weekly.map(q=>q.id)).toEqual(q2.weekly.map(q=>q.id));
  });
});

describe('recordPlay progress', () => {
  it('tracks 3D quest progress and awards XP', () => {
    const date = findDateForDailyQuest('d_play3d3');
    recordPlay('chess3d', ['3D'], date);
    recordPlay('maze3d', ['3D'], date);
    recordPlay('third3d', ['3D'], date);

    const q = getActiveQuests(date).daily.find(q => q.id === 'd_play3d3');
    expect(q.progress).toBe(3);
    expect(q.completed).toBe(true);
    expect(getXP()).toBeGreaterThanOrEqual(q.xp);
  });
});

describe('profile isolation', () => {
  it('separates progress per profile', () => {
    const date = findDateForDailyQuest('d_play3d3');
    localStorage.setItem('profile', 'p1');
    recordPlay('chess3d', ['3D'], date);
    recordPlay('maze3d', ['3D'], date);
    recordPlay('third3d', ['3D'], date);
    expect(getXP()).toBeGreaterThan(0);

    localStorage.setItem('profile', 'p2');
    const q = getActiveQuests(date).daily.find(q => q.id === 'd_play3d3');
    expect(q.progress).toBe(0);
    expect(getXP()).toBe(0);
  });
});
