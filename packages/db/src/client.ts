import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from './schema.js';

/**
 * Create a Drizzle client over postgres-js. One Neon Postgres backs the whole
 * Brain (ADR 0001). Callers should run tenant-scoped work through `withTenant`
 * (rls.ts) so Row-Level Security is always in force.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, { max: options?.max ?? 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Database = ReturnType<typeof createDb>['db'];
