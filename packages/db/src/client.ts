import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema.js';

/**
 * Detects a connection-pooled endpoint (Neon's PgBouncer pooler, or any URL that
 * opts into PgBouncer). Transaction-mode pooling does not support prepared
 * statements, so postgres-js must run unprepared against it. Migrations should
 * use the DIRECT (unpooled) endpoint instead.
 */
export function isPooledConnection(connectionString: string): boolean {
  return /-pooler\b/.test(connectionString) || /[?&]pgbouncer=true\b/.test(connectionString);
}

/**
 * Create a Drizzle client over postgres-js. One Neon Postgres backs the whole
 * Brain (ADR 0001). Callers should run tenant-scoped work through `withTenant`
 * (rls.ts) so Row-Level Security is always in force.
 *
 * SSL comes from the URL (`sslmode=require` for Neon, `disable` for local).
 * Prepared statements are disabled automatically against a pooled endpoint.
 */
export function createDb(connectionString: string, options?: { max?: number; prepare?: boolean }) {
  const prepare = options?.prepare ?? !isPooledConnection(connectionString);
  const client = postgres(connectionString, { max: options?.max ?? 10, prepare });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Database = ReturnType<typeof createDb>['db'];
