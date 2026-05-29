import { describe, expect, it } from 'vitest';
import { precisionAtK } from '../metrics.js';

describe('precisionAtK', () => {
  it('counts a hit when an expected id is within the top K', () => {
    const p = precisionAtK(
      [
        { ranked: ['a', 'b', 'c'], expected: new Set(['a']) },
        { ranked: ['x', 'y', 'z'], expected: new Set(['q']) },
      ],
      1,
    );
    expect(p).toBe(0.5);
  });

  it('is 0 for no scenarios', () => {
    expect(precisionAtK([], 3)).toBe(0);
  });
});
