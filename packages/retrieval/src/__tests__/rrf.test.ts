import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../rrf.js';

describe('reciprocal rank fusion', () => {
  it('rewards items that appear high in multiple lists', () => {
    const fused = reciprocalRankFusion([
      { ids: ['a', 'b', 'c'] }, // vector arm
      { ids: ['b', 'a', 'd'] }, // keyword arm
    ]);
    // 'a' and 'b' both rank high in both arms; one of them wins overall.
    expect(['a', 'b']).toContain(fused[0]?.id);
    expect(fused.map((f) => f.id)).toContain('d');
  });

  it('returns an empty ranking for no input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
