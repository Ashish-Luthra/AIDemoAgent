import { describe, expect, it } from 'vitest';
import { isPooledConnection } from '../client.js';

describe('isPooledConnection', () => {
  it('detects a Neon pooled endpoint', () => {
    expect(
      isPooledConnection(
        'postgres://u:p@ep-cool-name-pooler.us-east-1.aws.neon.tech/db?sslmode=require',
      ),
    ).toBe(true);
  });

  it('detects an explicit pgbouncer flag', () => {
    expect(isPooledConnection('postgres://u:p@host/db?sslmode=require&pgbouncer=true')).toBe(true);
  });

  it('treats a direct endpoint as unpooled', () => {
    expect(
      isPooledConnection('postgres://u:p@ep-cool-name.us-east-1.aws.neon.tech/db?sslmode=require'),
    ).toBe(false);
    expect(isPooledConnection('postgres://ashishluthra@localhost:5432/allyvate')).toBe(false);
  });
});
