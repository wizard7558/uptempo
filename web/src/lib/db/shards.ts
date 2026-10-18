import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema/tenants";

type ShardDb = ReturnType<typeof drizzle>;
type ShardClient = { sql: Sql; db: ShardDb };

const clients = new Map<string, ShardClient>();
let shardUrlRaw: string | undefined;
let shardUrls: Record<string, string> = {};

function readShardUrls(): Record<string, string> {
  const raw = process.env.DATABASE_SHARD_URLS ?? "";
  if (raw === shardUrlRaw) return shardUrls;
  if (!raw.trim()) {
    shardUrlRaw = raw;
    shardUrls = {};
    return shardUrls;
  }
  const parsed = JSON.parse(raw) as Record<string, string>;
  if (Object.prototype.hasOwnProperty.call(parsed, "primary")) {
    throw new Error("DATABASE_SHARD_URLS must not contain primary");
  }
  shardUrlRaw = raw;
  shardUrls = parsed;
  return shardUrls;
}

export function getShardClient(name: string): ShardClient {
  const cached = clients.get(name);
  if (cached) return cached;

  const urls = readShardUrls();
  let connectionString: string;
  if (name === "primary") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    connectionString = url;
  } else {
    const url = urls[name];
    if (!url) throw new Error(`Unknown shard "${name}"`);
    connectionString = url;
  }

  const sql = postgres(connectionString);
  const client = { sql, db: drizzle(sql) };
  clients.set(name, client);
  return client;
}

const shardBySlug = new Map<string, { shard: string; at: number }>();
const SHARD_TTL_MS = 60_000;

/** A missing row is primary and is not cached. A found row is cached for 60 seconds. */
export async function getShardForSlug(slug: string): Promise<string> {
  const hit = shardBySlug.get(slug);
  if (hit && Date.now() - hit.at < SHARD_TTL_MS) return hit.shard;

  const [row] = await publicDb
    .select({ dbShard: tenants.dbShard })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!row) return "primary";
  const shard = row.dbShard?.trim() || "primary";
  shardBySlug.set(slug, { shard, at: Date.now() });
  return shard;
}

export function newTenantShard(): string {
  return process.env.NEW_TENANT_SHARD?.trim() || "primary";
}

/** Close all cached shard clients for short-lived scripts and integration tests. */
export async function closeShardClients(): Promise<void> {
  const activeClients = [...clients.values()];
  clients.clear();
  shardBySlug.clear();
  await Promise.all(
    activeClients.map((client) => client.sql.end({ timeout: 5 })),
  );
}
