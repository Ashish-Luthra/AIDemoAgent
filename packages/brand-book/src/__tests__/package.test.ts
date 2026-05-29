import { describe, expect, it } from 'vitest';
import { PACKAGE } from '../index.js';

describe('@allyvate/brand-book', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE).toBe('@allyvate/brand-book');
  });
});
