// Apply db/schema.sql. Run: npx tsx --env-file=.env scripts/migrate.mts
import { readFileSync } from "node:fs";
import { pool } from "../lib/db.ts";

const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
await pool().query(sql);
// Appended (A4, /try judge demo): shops created from /try carry the demo session id. Normal search excludes them.
await pool().query(`alter table shops add column if not exists demo_session text`);
await pool().query(`create index if not exists shops_demo_session_idx on shops(demo_session) where demo_session is not null`);
const { rows } = await pool().query(
  "select table_name from information_schema.tables where table_schema='public' order by 1",
);
console.log("tables:", rows.map((r) => r.table_name).join(", "));
await pool().end();
