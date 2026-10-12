import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  after: () => {
    throw new Error("`after` was called outside a request scope");
  },
}));

import { runAfterResponse } from "./after";

describe("runAfterResponse", () => {
  it("still runs fn when after() throws", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    runAfterResponse(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("logs instead of throwing when fn rejects", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    runAfterResponse(() => Promise.reject(new Error("boom")));
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
