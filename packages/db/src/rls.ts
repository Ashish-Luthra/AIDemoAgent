import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Run a unit of work inside a transaction with the tenant GUC set, so every
 * query is filtered by the RLS `tenant_isolation` policy on `app.current_tenant`
 * (schema.ts). This is the multi-tenant boundary (KICKOFF lock #6). Always go
 * through here for tenant data — never query the tables raw with a privileged
 * role in request paths.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // `true` = local to this transaction; resets on commit/rollback.
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}
