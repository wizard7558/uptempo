import { describe, expect, it } from "vitest";
import { MODULE_IDS } from "@/lib/verticals/types";
import messages from "@/i18n/messages/en.json";
import {
  MODULE_AREAS,
  MODULE_CATALOG,
  isModuleEnabled,
  isToggleModule,
} from "./catalog";

const ids = (a: string) =>
  MODULE_CATALOG.filter((e) => e.availability === a).map((e) => e.id);

describe("module catalog", () => {
  it("covers every module id exactly once", () => {
    const catalogIds = MODULE_CATALOG.map((e) => e.id);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
    expect(new Set(catalogIds)).toEqual(new Set(MODULE_IDS));
  });

  it("has the expected toggle and always-on sets", () => {
    expect([...ids("toggle")].sort()).toEqual(
      ["assistant_tasks", "storefront", "aftercare", "requests", "on_site", "projects", "consent_id", "packages", "classes", "walk_in_queue", "slot_waitlist", "gift_cards", "attachments"].sort(),
    );
    expect([...ids("always_on")].sort()).toEqual(
      ["processing_time", "memberships"].sort(),
    );
    expect(ids("planned")).toHaveLength(3);
  });

  it("isModuleEnabled follows availability and the stored list", () => {
    expect(isModuleEnabled([], "processing_time")).toBe(true);
    expect(isModuleEnabled(["aftercare"], "aftercare")).toBe(true);
    expect(isModuleEnabled(["storefront"], "aftercare")).toBe(false);
    expect(isModuleEnabled(null, "aftercare")).toBe(false);
    expect(isModuleEnabled("aftercare", "aftercare")).toBe(false);
    expect(isModuleEnabled({}, "aftercare")).toBe(false);
    expect(isModuleEnabled(["classes"], "classes")).toBe(true);
  });

  it("isToggleModule accepts only toggle modules", () => {
    expect(isToggleModule("aftercare")).toBe(true);
    expect(isToggleModule("memberships")).toBe(false);
    expect(isToggleModule("packages")).toBe(true);
    expect(isToggleModule("classes")).toBe(true);
    expect(isToggleModule("bogus")).toBe(false);
  });

  it("en.json has copy for every module and area", () => {
    const m = messages.modules as unknown as {
      items: Record<string, { name?: string; description?: string }>;
      areas: Record<string, string>;
    };
    for (const e of MODULE_CATALOG) {
      expect(m.items[e.id]?.name, `${e.id}.name`).toBeTruthy();
      expect(m.items[e.id]?.description, `${e.id}.description`).toBeTruthy();
    }
    for (const area of MODULE_AREAS) {
      expect(m.areas[area], area).toBeTruthy();
    }
  });
});
