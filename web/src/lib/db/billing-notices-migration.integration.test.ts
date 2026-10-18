import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const itDb = databaseUrl ? it : it.skip;

describe("public billing-notice migration 0037 (integration)", () => {
  itDb("keeps existing tenants null and defaults only new tenants to the current price", async () => {
    const client = postgres(databaseUrl!, { max: 1 });
    const schema = `billingnotice_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0037_billing_switch_notices.sql"),
      "utf8",
    );
    const rollback = readFileSync(
      resolve(process.cwd(), "drizzle/rollback/0037_billing_switch_notices.down.sql"),
      "utf8",
    );
    const execute = async (source: string, delimiter: string) => {
      for (const statement of source
        .split(delimiter)
        .map((part) => part.trim())
        .filter(Boolean)) {
        await client.unsafe(statement);
      }
    };

    try {
      await client.unsafe(`CREATE SCHEMA "${schema}"`);
      await client.unsafe(`SET search_path TO "${schema}"`);
      await client.unsafe(
        "CREATE TABLE tenants (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL)",
      );
      await client.unsafe(
        "INSERT INTO tenants (id, name, slug) VALUES ('legacy-a', 'Legacy A', 'legacy-a'), ('legacy-b', 'Legacy B', 'legacy-b')",
      );

      await execute(migration, "--> statement-breakpoint");
      const legacy = await client.unsafe(
        "SELECT slug, billing_notice_sent_at, billing_switch_at, billing_notice_payload_hash, billing_switched_at FROM tenants ORDER BY slug",
      );
      expect(
        legacy.map((row) => [
          row.slug,
          row.billing_notice_sent_at,
          row.billing_switch_at,
          row.billing_notice_payload_hash,
          row.billing_switched_at,
        ]),
      ).toEqual([
        ["legacy-a", null, null, null, null],
        ["legacy-b", null, null, null, null],
      ]);

      await client.unsafe(
        "INSERT INTO tenants (id, name, slug) VALUES ('new-a', 'New A', 'new-a')",
      );
      const [newTenant] = await client.unsafe(
        "SELECT billing_switched_at FROM tenants WHERE slug = 'new-a'",
      );
      expect(newTenant.billing_switched_at).toBeInstanceOf(Date);

      await client.unsafe(
        "UPDATE tenants SET billing_notice_sent_at = now(), billing_switch_at = now() + interval '60 days', billing_notice_payload_hash = 'payload' WHERE slug = 'legacy-a'",
      );
      await execute(rollback, ";");
      const remainingColumns = await client.unsafe(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'tenants' ORDER BY column_name",
        [schema],
      );
      expect(remainingColumns.map((row) => row.column_name)).toEqual([
        "id",
        "name",
        "slug",
      ]);
      const preservedRows = await client.unsafe("SELECT count(*)::int AS n FROM tenants");
      expect(preservedRows[0].n).toBe(3);
    } finally {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);
});
