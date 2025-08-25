/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getFavorites, toggleFavorite } from '../shared/ui.js';

describe('favorites', () => {
  beforeEach(() => localStorage.clear());
  it('toggles favorites and persists', () => {
    expect(getFavorites()).toEqual([]);
    toggleFavorite('g1');
    expect(getFavorites()).toEqual(['g1']);
    toggleFavorite('g1');
    expect(getFavorites()).toEqual([]);
  });
});
