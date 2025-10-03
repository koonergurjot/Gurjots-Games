import { describe, it, expect } from 'vitest';
import { adaptGameForLanding, deriveComparableTimestamp } from '../js/catalog-utils.js';

describe('catalog timestamp caching', () => {
  it('preserves newest sort order when using cached timestamps', () => {
    const rawGames=[
      { id:'alpha', title:'Alpha', description:'Oldest', addedAt:'2022-04-01' },
      { id:'bravo', title:'Bravo', description:'Middle', release_date:'2023-09-15' },
      { id:'charlie', title:'Charlie', description:'Newest', updatedAt:'2024-02-20' }
    ];

    const adapted=rawGames.map(adaptGameForLanding);

    adapted.forEach(game=>{
      expect(typeof game.comparableTimestamp).toBe('number');
    });

    const cachedOrder=[...adapted]
      .sort((a,b)=>(b.comparableTimestamp??0)-(a.comparableTimestamp??0))
      .map(g=>g.id);
    const derivedOrder=[...adapted]
      .sort((a,b)=>deriveComparableTimestamp(b)-deriveComparableTimestamp(a))
      .map(g=>g.id);

    expect(cachedOrder).toEqual(derivedOrder);
  });
});
