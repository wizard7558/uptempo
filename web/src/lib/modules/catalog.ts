import { MODULE_IDS, type ModuleId } from "@/lib/verticals/types";

/** Client-safe: no DB imports. */
export const MODULE_AREAS = [
  "booking",
  "team",
  "selling",
  "requests",
  "client_care",
] as const;
export type ModuleArea = (typeof MODULE_AREAS)[number];

/**
 * - toggle: built and gated; owners can turn it on and off.
 * - always_on: built, but always available for now.
 * - planned: not built yet; hidden in settings.
 */
export type ModuleAvailability = "toggle" | "always_on" | "planned";

export type ModuleCatalogEntry = {
  id: ModuleId;
  area: ModuleArea;
  availability: ModuleAvailability;
};

export const MODULE_CATALOG: ReadonlyArray<ModuleCatalogEntry> = [
  { id: "processing_time", area: "booking", availability: "always_on" },
  { id: "resources", area: "booking", availability: "planned" },
  { id: "booking_groups", area: "booking", availability: "planned" },
  { id: "recurring", area: "booking", availability: "planned" },
  { id: "classes", area: "booking", availability: "toggle" },
  { id: "walk_in_queue", area: "booking", availability: "toggle" },
  { id: "slot_waitlist", area: "booking", availability: "toggle" },
  { id: "on_site", area: "booking", availability: "toggle" },
  { id: "assistant_tasks", area: "team", availability: "toggle" },
  { id: "memberships", area: "selling", availability: "always_on" },
  { id: "packages", area: "selling", availability: "toggle" },
  { id: "gift_cards", area: "selling", availability: "toggle" },
  { id: "storefront", area: "selling", availability: "toggle" },
  { id: "requests", area: "requests", availability: "toggle" },
  { id: "projects", area: "requests", availability: "toggle" },
  { id: "consent_id", area: "client_care", availability: "toggle" },
  { id: "attachments", area: "client_care", availability: "toggle" },
  { id: "aftercare", area: "client_care", availability: "toggle" },
];

const BY_ID: ReadonlyMap<string, ModuleCatalogEntry> = new Map(
  MODULE_CATALOG.map((e) => [e.id, e]),
);

export function getModuleEntry(id: ModuleId): ModuleCatalogEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown module: ${id}`);
  return entry;
}

/** `raw` is the stored `tenants.modules` value. */
export function isModuleEnabled(raw: unknown, id: ModuleId): boolean {
  return (
    getModuleEntry(id).availability === "always_on" ||
    (Array.isArray(raw) && raw.includes(id))
  );
}

/** True when `id` is a known module that owners can switch on and off. */
export function isToggleModule(id: string): id is ModuleId {
  return BY_ID.get(id)?.availability === "toggle";
}

export { MODULE_IDS };
