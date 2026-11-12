// Single Postgres pool (Render Postgres requires SSL). Server-only.
import { Pool, type QueryResultRow } from "pg";

const globalForPg = globalThis as unknown as { __shelfPool?: Pool };

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 5,
  });
}

export function pool(): Pool {
  // Reuse across Next.js hot reloads in dev.
  globalForPg.__shelfPool ??= makePool();
  return globalForPg.__shelfPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
