import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { nextLeaseGeneration } from "./lease.js";
import { LedgerConflict } from "./memory-sql.js";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

/** Cloud SQL / local Postgres client. Auth Proxy is not a pooler — keep `max` tiny on Cloud Run. */
export function createPgPool(connectionString: string, max = 4): postgres.Sql {
  return postgres(connectionString, {
    max,
    prepare: false,
    // Unix socket from Cloud Run `--add-cloudsql-instances`:
    // postgresql://user@/db?host=/cloudsql/PROJECT:REGION:INSTANCE
  });
}

/** Apply the kernel DDL. Idempotent. */
export async function migrate(sql: postgres.Sql): Promise<void> {
  const source = readFileSync(schemaPath, "utf8");
  await sql.unsafe(source);
}

/**
 * Take a workspace lease with `SELECT … FOR UPDATE` on the workspace row, then upsert `leases`.
 */
export async function acquirePgLease(
  sql: postgres.Sql,
  workspaceId: string,
  holder: string,
  ttlMs: number,
): Promise<number> {
  return await sql.begin(async (tx) => {
    const ws = await tx`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
    if (ws.length !== 1) {
      throw new Error(`unknown workspace ${workspaceId}`);
    }
    const existing = await tx`
      SELECT holder, generation, expires_at FROM leases WHERE workspace_id = ${workspaceId}
    `;
    const now = new Date();
    const snapshot = existing.length === 1
      ? {
          holder: (existing[0] as { holder: string }).holder,
          generation: (existing[0] as { generation: number }).generation,
          expiresAt: (existing[0] as { expires_at: Date }).expires_at.getTime(),
        }
      : undefined;
    nextLeaseGeneration(snapshot, holder, now.getTime());
    const upsert = await tx`
      INSERT INTO leases (workspace_id, holder, generation, expires_at)
      VALUES (${workspaceId}, ${holder}, 1, ${new Date(now.getTime() + ttlMs)})
      ON CONFLICT (workspace_id) DO UPDATE SET
        holder = EXCLUDED.holder,
        generation = leases.generation + 1,
        expires_at = EXCLUDED.expires_at
      RETURNING generation
    `;
    return (upsert[0] as { generation: number }).generation;
  });
}

export { LedgerConflict };
