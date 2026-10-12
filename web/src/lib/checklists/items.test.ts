import { describe, expect, it } from "vitest";
import { normalizeChecklistItems } from "./items";

describe("normalizeChecklistItems", () => {
  it("trims labels, drops blanks, and keeps the first id", () => {
    const result = normalizeChecklistItems([
      { id: "s1", label: "  Clean station  " },
      { id: "s2", label: "   " },
      { label: "Stencil approved" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toEqual({ id: "s1", label: "Clean station" });
    expect(result.items).toHaveLength(2);
    expect(result.items[1].label).toBe("Stencil approved");
    expect(result.items[1].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("refuses 31 steps and a label over 120 characters", () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => ({ label: `Step ${i + 1}` }));
    expect(normalizeChecklistItems(tooMany)).toEqual({ ok: false, error: "tooMany" });
    expect(normalizeChecklistItems([{ label: "x".repeat(121) }])).toEqual({
      ok: false,
      error: "label",
    });
  });

  it("gives a duplicate id a new one", () => {
    const result = normalizeChecklistItems([
      { id: "same", label: "First" },
      { id: "same", label: "Second" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].id).toBe("same");
    expect(result.items[1].id).not.toBe("same");
  });
});
