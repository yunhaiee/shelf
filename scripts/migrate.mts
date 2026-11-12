// Apply db/schema.sql. Run: npx tsx --env-file=.env scripts/migrate.mts
import { readFileSync } from "node:fs";
import { pool } from "../lib/db.ts";

const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
await pool().query(sql);
const { rows } = await pool().query(
  "select table_name from information_schema.tables where table_schema='public' order by 1",
);
console.log("tables:", rows.map((r) => r.table_name).join(", "));
await pool().end();
