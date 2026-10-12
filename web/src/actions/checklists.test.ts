// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  assertModule: vi.fn(),
  loadTemplates: vi.fn(),
  upsert: vi.fn(),
  listAppointment: vi.fn(),
  markDone: vi.fn(),
  insertItem: vi.fn(),
  deleteItem: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: (...args: unknown[]) => h.requireStaff(...args),
}));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: (...args: unknown[]) => h.assertModule(...args),
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));
vi.mock("@/lib/checklists/service", () => ({
  listChecklistTemplates: (...args: unknown[]) => h.loadTemplates(...args),
  saveChecklistTemplate: (...args: unknown[]) => h.upsert(...args),
  listAppointmentChecklist: (...args: unknown[]) => h.listAppointment(...args),
  setChecklistItemDone: (...args: unknown[]) => h.markDone(...args),
  addChecklistItem: (...args: unknown[]) => h.insertItem(...args),
  removeChecklistItem: (...args: unknown[]) => h.deleteItem(...args),
}));

import {
  addChecklistItem,
  getAppointmentChecklist,
  listChecklistTemplates,
  removeChecklistItem,
  saveChecklistTemplate,
  setChecklistItemDone,
} from "./checklists";

const ADMIN = ["owner", "admin"];
const TEAM = ["owner", "admin", "provider", "assistant"];
const SERVICE = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  h.requireStaff.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });
  h.assertModule.mockResolvedValue(undefined);
});

describe("checklist action roles", () => {
  it("lists templates for owners and admins", async () => {
    h.loadTemplates.mockResolvedValue([
      { serviceId: SERVICE, serviceName: "Cut", items: [{ id: "s1", label: "Clean station" }] },
    ]);
    const rows = await listChecklistTemplates();
    expect(h.requireStaff).toHaveBeenCalledWith(...ADMIN);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(rows).toEqual([
      { serviceId: SERVICE, serviceName: "Cut", items: [{ id: "s1", label: "Clean station" }] },
    ]);
  });

  it("saves a template for owners and admins", async () => {
    h.upsert.mockResolvedValue({ ok: true, items: [{ id: "s1", label: "Clean station" }] });
    const saved = await saveChecklistTemplate({
      serviceId: SERVICE,
      items: [{ id: "s1", label: "Clean station" }],
    });
    expect(h.requireStaff).toHaveBeenCalledWith(...ADMIN);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(saved).toEqual({ ok: true, items: [{ id: "s1", label: "Clean station" }] });
    expect(h.upsert).toHaveBeenCalledWith("acme", SERVICE, [{ id: "s1", label: "Clean station" }]);
  });

  it("reads an appointment checklist for the whole team", async () => {
    h.listAppointment.mockResolvedValue([
      {
        id: ITEM,
        label: "Clean station",
        sortOrder: 101,
        sourceKey: "tpl:s1",
        doneAt: new Date("2026-10-11T15:00:00.000Z"),
        doneBy: "u1",
      },
    ]);
    const rows = await getAppointmentChecklist(APPOINTMENT);
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(rows).toEqual([
      {
        id: ITEM,
        label: "Clean station",
        sortOrder: 101,
        sourceKey: "tpl:s1",
        doneAt: "2026-10-11T15:00:00.000Z",
        doneBy: "u1",
      },
    ]);
  });

  it("checks an item for the whole team and refuses a bad id", async () => {
    h.markDone.mockResolvedValue(true);
    const saved = await setChecklistItemDone({ itemId: ITEM, done: true });
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(saved).toEqual({ ok: true });
    expect(h.markDone).toHaveBeenCalledWith("acme", ITEM, true, "u1");

    const refused = await setChecklistItemDone({ itemId: "not-a-uuid", done: true });
    expect(refused).toEqual({ ok: false, error: "errors.notFound" });
    expect(h.markDone).toHaveBeenCalledTimes(1);
  });

  it("adds an item for the whole team", async () => {
    h.insertItem.mockResolvedValue({
      ok: true,
      item: {
        id: ITEM,
        label: "Extra towel",
        sortOrder: 4,
        sourceKey: null,
        doneAt: null,
        doneBy: null,
      },
    });
    const added = await addChecklistItem({ appointmentId: APPOINTMENT, label: "Extra towel" });
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(added).toEqual({
      ok: true,
      item: {
        id: ITEM,
        label: "Extra towel",
        sortOrder: 4,
        sourceKey: null,
        doneAt: null,
        doneBy: null,
      },
    });
  });

  it("removes an ad-hoc item for the whole team", async () => {
    h.deleteItem.mockResolvedValue(true);
    const removed = await removeChecklistItem({ itemId: ITEM });
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(removed).toEqual({ ok: true });
    expect(h.deleteItem).toHaveBeenCalledWith("acme", ITEM);
  });

  it("lets an auth failure leave the action", async () => {
    const error = Object.assign(new Error("Not signed in"), {
      name: "AuthError",
      code: "UNAUTHENTICATED",
    });
    h.requireStaff.mockRejectedValue(error);
    await expect(listChecklistTemplates()).rejects.toMatchObject({
      name: "AuthError",
      code: "UNAUTHENTICATED",
    });
    expect(h.loadTemplates).not.toHaveBeenCalled();
  });
});
