/**
 * Pure helpers for scripts/rollback-0040.ts (kept under src/ so Vitest covers them).
 * No DB access and no env access here.
 */

export type JournalEntry = { idx: number; when: number; tag: string };

/** Split a drizzle SQL file on `--> statement-breakpoint`, trimming and dropping empties. */
export function splitStatementBreakpoints(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Find the journal entry whose tag starts with `prefix` (e.g. "0026_"). Throws unless exactly one matches. */
export function findJournalEntry(journal: { entries: JournalEntry[] }, prefix: string): JournalEntry {
  const matches = journal.entries.filter((e) => e.tag.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one journal entry with tag prefix ${prefix}, found ${matches.length}`);
  }
  return matches[0];
}

export function parseHost(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return new URL(databaseUrl).host;
}

/** With --apply, the confirmed host must equal the DATABASE_URL host exactly. Returns an error message or null. */
export function checkHostConfirmation(opts: {
  apply: boolean;
  host: string;
  confirmHost: string | undefined;
}): string | null {
  if (!opts.apply) return null;
  if (!opts.confirmHost) return `--apply requires --confirm-host=<db host> (target host is ${opts.host})`;
  if (opts.confirmHost !== opts.host) {
    return `--confirm-host does not match the target host (target host is ${opts.host}). Refusing.`;
  }
  return null;
}

export type Scope = "all" | "public" | "tenants";

export function parseScope(value: string | undefined): Scope {
  const v = value ?? "all";
  if (v === "all" || v === "public" || v === "tenants") return v;
  throw new Error(`invalid --scope=${v} (expected all|public|tenants)`);
}
