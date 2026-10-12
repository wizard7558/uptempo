import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  splitStatementBreakpoints,
  findJournalEntry,
  parseHost,
  checkHostConfirmation,
  parseScope,
} from "./rollback-0040";

describe("splitStatementBreakpoints", () => {
  it("splits and trims, dropping empties", () => {
    expect(splitStatementBreakpoints("A;--> statement-breakpoint\nB;\n--> statement-breakpoint\n")).toEqual(["A;", "B;"]);
  });
  it("splits the real 0026 down file into three UPDATEs", () => {
    const text = readFileSync(join(process.cwd(), "drizzle/rollback/0026_staff_role_provider.down.sql"), "utf8");
    const stmts = splitStatementBreakpoints(text);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('-- Rollback for 0026');
    expect(stmts.filter((s) => s.includes("UPDATE"))).toHaveLength(3);
  });
});

describe("findJournalEntry", () => {
  const journal = {
    entries: [
      { idx: 25, when: 1, tag: "0025_x" },
      { idx: 26, when: 1791571272134, tag: "0026_staff_role_provider" },
    ],
  };
  it("finds by prefix", () => {
    expect(findJournalEntry(journal, "0026_").when).toBe(1791571272134);
  });
  it("throws on none or multiple", () => {
    expect(() => findJournalEntry(journal, "0099_")).toThrow();
    expect(() => findJournalEntry({ entries: [...journal.entries, { idx: 27, when: 2, tag: "0026_dup" }] }, "0026_")).toThrow();
  });
  it("matches the real journal", () => {
    const real = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(findJournalEntry(real, "0026_").tag).toBe("0026_staff_role_provider");
  });
});

describe("host guard", () => {
  it("parseHost returns host only", () => {
    expect(parseHost("postgres://u:p@db.example.com:5432/x")).toBe("db.example.com:5432");
    expect(() => parseHost(undefined)).toThrow();
  });
  it("dry run never needs confirmation", () => {
    expect(checkHostConfirmation({ apply: false, host: "h", confirmHost: undefined })).toBeNull();
  });
  it("apply refuses missing or mismatched host", () => {
    expect(checkHostConfirmation({ apply: true, host: "h", confirmHost: undefined })).toMatch(/requires/);
    expect(checkHostConfirmation({ apply: true, host: "h", confirmHost: "other" })).toMatch(/does not match/);
  });
  it("apply allows exact match only", () => {
    expect(checkHostConfirmation({ apply: true, host: "h", confirmHost: "h" })).toBeNull();
    expect(checkHostConfirmation({ apply: true, host: "h", confirmHost: "H" })).not.toBeNull();
  });
});

describe("parseScope", () => {
  it("defaults to all and validates", () => {
    expect(parseScope(undefined)).toBe("all");
    expect(parseScope("public")).toBe("public");
    expect(() => parseScope("nope")).toThrow();
  });
});
