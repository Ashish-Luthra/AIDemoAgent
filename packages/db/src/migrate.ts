import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Apply migrations. Ensures pgvector + pg_trgm exist first — the typed-edge /
 * vector / keyword DDL depends on them (one Postgres, five jobs — ADR 0001).
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required to run migrations');

const client = postgres(url, { max: 1 });
const db = drizzle(client);

await client`CREATE EXTENSION IF NOT EXISTS vector`;
await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
await migrate(db, { migrationsFolder });

await client.end();
console.log('✓ migrations applied');
