import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOBS } from "./registry";

describe("JOBS", () => {
  it("matches vercel.json crons and uses unique ids", () => {
    const vercel = JSON.parse(
      readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"),
    ) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toEqual(JOBS.map(({ path, schedule }) => ({ path, schedule })));
    expect(new Set(JOBS.map((job) => job.id)).size).toBe(JOBS.length);
  });
});
