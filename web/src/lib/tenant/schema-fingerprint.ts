import { sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { getShardClient, getShardForSlug } from "@/lib/db/shards";

/** Sorted, schema-name-free description of a tenant schema (columns, constraints, indexes). */
export async function schemaFingerprint(schemaName: string): Promise<string[]> {
  const slug = schemaName.startsWith("tenant_") ? schemaName.slice("tenant_".length) : "";
  const shard = slug ? await getShardForSlug(slug) : "primary";
  const db = shard === "primary" ? publicDb : getShardClient(shard).db;
  const lines = async (q: ReturnType<typeof sql>) =>
    Array.from((await db.execute(q)) as Iterable<{ line: string }>).map((r) => r.line);
  const all = [
    ...(await lines(sql`SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS line FROM information_schema.columns WHERE table_schema = ${schemaName}`)),
    ...(await lines(sql`SELECT 'con ' || t.relname || '.' || c.conname || ' ' || c.contype::text || ' ' || pg_get_constraintdef(c.oid) AS line FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = ${schemaName}`)),
    ...(await lines(sql`SELECT 'idx ' || tablename || '.' || indexname || ' ' || indexdef AS line FROM pg_indexes WHERE schemaname = ${schemaName}`)),
  ];
  return all.map((l) => l.replaceAll(schemaName, "<schema>")).sort();
}
