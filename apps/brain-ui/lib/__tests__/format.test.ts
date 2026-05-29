import { describe, expect, it } from 'vitest';
import { formatConfidence } from '../format.js';

describe('formatConfidence', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatConfidence(0.73)).toBe('73%');
  });

  it('clamps out-of-range values', () => {
    expect(formatConfidence(1.5)).toBe('100%');
    expect(formatConfidence(-0.2)).toBe('0%');
  });
});
