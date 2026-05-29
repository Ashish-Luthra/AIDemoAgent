import { describe, expect, it } from 'vitest';
import { PACKAGE } from '../index.js';

describe('@allyvate/mcp-clients', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE).toBe('@allyvate/mcp-clients');
  });
});
