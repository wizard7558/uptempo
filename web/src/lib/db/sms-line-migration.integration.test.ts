import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const itDb = databaseUrl ? it : it.skip;

describe("public SMS line migration 0036 (integration)", () => {
  itDb("backfills existing tenants, defaults new tenants off, preserves reapplications, and rolls back", async () => {
    const client = postgres(databaseUrl!, { max: 1 });
    const schema = `smsline_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const migration = readFileSync(resolve(process.cwd(), "drizzle/0036_sms_line_registration.sql"), "utf8");
    const rollback = readFileSync(resolve(process.cwd(), "drizzle/rollback/0036_sms_line_registration.down.sql"), "utf8");
    const executeUp = async () => {
      for (const statement of migration.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
        await client.unsafe(statement);
      }
    };
    const executeDown = async () => {
      for (const statement of rollback.split(";").map((part) => part.trim()).filter(Boolean)) {
        await client.unsafe(statement);
      }
    };

    try {
      await client.unsafe(`CREATE SCHEMA "${schema}"`);
      await client.unsafe(`SET search_path TO "${schema}"`);
      await client.unsafe("CREATE TABLE tenants (id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL)");
      await client.unsafe("INSERT INTO tenants (id, name, slug) VALUES ('old-a', 'Old A', 'old-a'), ('old-b', 'Old B', 'old-b')");

      await executeUp();
      const backfilled = await client.unsafe("SELECT slug, sms_line_status FROM tenants ORDER BY slug");
      expect(backfilled.map((row) => row.sms_line_status)).toEqual(["shared", "shared"]);

      await client.unsafe("INSERT INTO tenants (id, name, slug) VALUES ('new-a', 'New A', 'new-a')");
      await client.unsafe("UPDATE tenants SET sms_line_status = 'active' WHERE slug = 'old-a'");
      await executeUp();
      const reapplied = await client.unsafe("SELECT slug, sms_line_status FROM tenants ORDER BY slug");
      expect(Object.fromEntries(reapplied.map((row) => [row.slug, row.sms_line_status]))).toEqual({
        "new-a": "off",
        "old-a": "active",
        "old-b": "shared",
      });
      await expect(client.unsafe("UPDATE tenants SET sms_line_status = 'unknown' WHERE slug = 'new-a'")).rejects.toThrow();

      await executeDown();
      const restoredColumns = await client.unsafe(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'tenants' ORDER BY column_name",
        [schema],
      );
      expect(restoredColumns.map((row) => row.column_name)).toEqual(["id", "name", "slug"]);
      const preserved = await client.unsafe("SELECT count(*)::int AS n FROM tenants");
      expect(preserved[0].n).toBe(3);

      await executeUp();
      const secondRound = await client.unsafe("SELECT slug, sms_line_status FROM tenants ORDER BY slug");
      expect(secondRound.map((row) => row.sms_line_status)).toEqual(["shared", "shared", "shared"]);
      await client.unsafe("INSERT INTO tenants (id, name, slug) VALUES ('new-b', 'New B', 'new-b')");
      const [newRow] = await client.unsafe("SELECT sms_line_status FROM tenants WHERE slug = 'new-b'");
      expect(newRow.sms_line_status).toBe("off");
    } finally {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);
});
