import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "hydration-replay.fixture.cjs");

it("keeps nested lazy hydration useId values aligned with the SSR tree", () => {
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    const child = spawnSync(process.execPath, [fixture], {
      cwd: path.resolve(here, ".."),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, NODE_ENV: "development" },
    });

    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout.trim());
    expect(result.rendererVersionsMatch).toBe(true);
    expect(result.schedulerAliasVerified).toBe(true);
    expect(result.clientRenderCounts).toEqual({
      OuterComponent: 2,
      InnerComponent: 1,
      Sibling: 1,
    });
    expect(result.clientIds.OuterComponent).toHaveLength(2);
    expect(result.clientIds.InnerComponent).toHaveLength(1);
    expect(result.clientIds.Sibling).toHaveLength(1);
    for (const name of ["OuterComponent", "InnerComponent", "Sibling"]) {
      expect(result.serverIds[name]).toHaveLength(1);
      expect(result.clientIds[name].every((id) => id === result.serverIds[name][0])).toBe(true);
    }
    expect(result.finalYieldOrder).toEqual([
      `OuterComponent id: ${result.serverIds.OuterComponent[0]}`,
      `InnerComponent id: ${result.serverIds.InnerComponent[0]}`,
      `Sibling id: ${result.serverIds.Sibling[0]}`,
    ]);
    expect(result.domMatchesSSR).toBe(true);
    expect(result.consoleWarnings).toBe(0);
    expect(result.consoleErrors).toBe(0);
    expect(result.recoverableErrors).toBe(0);
    expect(result.caughtErrors).toBe(0);
    expect(result.uncaughtErrors).toBe(0);
    expect(result.serverErrors).toBe(0);
    expect(result.asyncErrors).toBe(0);
    expect(result.pendingSchedulerWork).toBe(false);
    runs.push(result);
  }

  expect(runs).toHaveLength(3);
}, 65_000);
