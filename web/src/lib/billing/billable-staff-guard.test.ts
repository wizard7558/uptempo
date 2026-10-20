import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every file that inserts or updates tenant staff rows must call
 * syncBillableStaff so the Stripe extra-staff quantity follows the team.
 */

const SRC_DIR = path.resolve(__dirname, "..", "..");
const STAFF_WRITE = /\.(insert|update)\(staff\)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("billable staff sync guard", () => {
  it("every file writing staff rows calls syncBillableStaff", () => {
    const offenders = walk(SRC_DIR)
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return STAFF_WRITE.test(source) && !source.includes("syncBillableStaff(");
      })
      .map((file) => path.relative(SRC_DIR, file));
    expect(
      offenders,
      `These files write staff rows without calling syncBillableStaff():\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
