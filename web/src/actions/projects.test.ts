// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const APPT = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => {
  class ModuleDisabledError extends Error {}
  return {
    ModuleDisabledError,
    requireRole: vi.fn(),
    assertModule: vi.fn(),
    getActorStaffId: vi.fn(),
    /** Rows handed to successive awaited queries. */
    queue: [] as unknown[],
    writes: [] as string[],
  };
});

/** A query builder that records writes and resolves to the next queued result. */
function chain(kind: string): unknown {
  const p: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(h.queue.shift() ?? []);
      }
      return () => p;
    },
    apply: () => p,
  });
  void kind;
  return p;
}

vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string, values?: Record<string, string>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return String(node).replace(/\{(\w+)\}/g, (m, k) => values?.[k] ?? m);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: h.requireRole,
  requireStaff: async () => ({ userId: "u1", role: "provider", tenantSlug: "acme" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/auth/actor-staff", () => ({ getActorStaffId: h.getActorStaffId }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "acme" }));
vi.mock("@/lib/tenant/registry", () => ({ getTenantBySlug: vi.fn() }));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: h.assertModule,
  hasModule: vi.fn(),
  ModuleDisabledError: h.ModuleDisabledError,
}));
vi.mock("@/lib/attachments/service", () => ({
  AttachmentError: class extends Error {},
  createAttachment: vi.fn(),
}));
vi.mock("@/lib/projects/deliver", () => ({
  absoluteProjectUrl: () => "https://x.test/book/acme/project/t",
  deliverDesign: vi.fn(),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, fn: (db: unknown, t: unknown) => unknown) => {
    const tables = new Proxy({}, { get: () => new Proxy({}, { get: (_t, c) => String(c) }) });
    const db = {
      select: () => chain("select"),
      insert: () => {
        h.writes.push("insert");
        return chain("insert");
      },
      update: () => {
        h.writes.push("update");
        return chain("update");
      },
    };
    return fn(db, tables);
  },
}));

import {
  createProject,
  linkAppointmentToProject,
  listProjects,
  approveDesign,
  sendDesignForApproval,
  updateProject,
  uploadProjectDesign,
} from "./projects";

const provider = () => {
  h.requireRole.mockResolvedValue({ userId: "u1", role: "provider", tenantSlug: "acme" });
  h.getActorStaffId.mockResolvedValue(ME);
};
const owner = () => {
  h.requireRole.mockResolvedValue({ userId: "u2", role: "owner", tenantSlug: "acme" });
};

const update = {
  id: PROJECT,
  title: "Sleeve",
  estSessions: 3,
  status: "design" as const,
};

beforeEach(() => {
  h.requireRole.mockReset();
  h.assertModule.mockReset();
  h.assertModule.mockResolvedValue(undefined);
  h.getActorStaffId.mockReset();
  h.queue.length = 0;
  h.writes.length = 0;
});

describe("project authorization", () => {
  it("refuses a provider editing another staff member's project", async () => {
    provider();
    h.queue.push([{ staffId: OTHER }]);
    const res = await updateProject(update);
    expect(res).toEqual({ success: false, error: "You can only change your own projects." });
    expect(h.writes).toEqual([]);
  });

  it("refuses a provider editing an unassigned project", async () => {
    provider();
    h.queue.push([{ staffId: null }]);
    expect(await updateProject(update)).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
  });

  it("lets a provider edit their own project", async () => {
    provider();
    h.queue.push([{ staffId: ME }], [{ id: ME }]);
    expect(await updateProject({ ...update, staffId: ME })).toEqual({ success: true });
    expect(h.writes).toEqual(["update"]);
  });

  it("refuses a provider handing their project to someone else", async () => {
    provider();
    h.queue.push([{ staffId: ME }]);
    expect(await updateProject({ ...update, staffId: OTHER })).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
  });

  it("lets an owner edit any project", async () => {
    owner();
    h.queue.push([{ staffId: OTHER }], [{ id: OTHER }]);
    expect(await updateProject({ ...update, staffId: OTHER })).toEqual({ success: true });
  });

  it("refuses a provider who creates a project for someone else", async () => {
    provider();
    const res = await createProject({ clientId: APPT, staffId: OTHER, title: "Sleeve", estSessions: 2 });
    expect(res).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
  });

  it("refuses a provider linking an appointment to another staff member's project", async () => {
    provider();
    h.queue.push([{ clientId: "c1", projectId: null }], [{ staffId: OTHER, clientId: "c1" }]);
    expect(await linkAppointmentToProject(APPT, PROJECT)).toEqual({
      success: false,
      error: "You can only change your own projects.",
    });
    expect(h.writes).toEqual([]);
  });

  it("refuses to link an appointment to another client's project", async () => {
    owner();
    h.queue.push([{ clientId: "c1", projectId: null }], [{ staffId: ME, clientId: "c2" }]);
    expect(await linkAppointmentToProject(APPT, PROJECT)).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
  });

  it("refuses a provider uploading or sending a design for another's project", async () => {
    provider();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "d.png", { type: "image/png" }));
    h.queue.push([{ staffId: OTHER, clientId: "c1" }]);
    expect(await uploadProjectDesign(PROJECT, form)).toMatchObject({ success: false });
    h.queue.push([{ staffId: OTHER, designAttachmentId: "a", token: "t", clientId: "c1", email: "a@b.c", phone: null }]);
    expect(await sendDesignForApproval(PROJECT)).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
  });
});

describe("module gating", () => {
  beforeEach(() => {
    owner();
    h.assertModule.mockRejectedValue(new h.ModuleDisabledError("Projects is turned off."));
  });

  it("writes return the module-off sentence and touch nothing", async () => {
    expect(await createProject({ clientId: APPT, title: "x", estSessions: 1 })).toEqual({
      success: false,
      error: "Projects is turned off.",
    });
    expect(await updateProject(update)).toMatchObject({ success: false, error: "Projects is turned off." });
    expect(await linkAppointmentToProject(APPT, null)).toMatchObject({ success: false });
    expect(await sendDesignForApproval(PROJECT)).toMatchObject({ success: false });
    expect(await uploadProjectDesign(PROJECT, new FormData())).toMatchObject({ success: false });
    expect(h.writes).toEqual([]);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "projects");
  });

  it("reads refuse too", async () => {
    await expect(listProjects("all")).rejects.toBeInstanceOf(h.ModuleDisabledError);
  });
});

describe("error copy", () => {
  it("comes from projects.errors in the catalog", async () => {
    owner();
    expect(await createProject({ clientId: "not-a-uuid", title: "", estSessions: 0 })).toEqual({
      success: false,
      error: messages.projects.errors.invalid,
    });
    expect(await uploadProjectDesign(PROJECT, new FormData())).toEqual({
      success: false,
      error: messages.projects.errors.chooseImage,
    });
    expect(await approveDesign({ slug: "acme", token: "short", name: "A" })).toEqual({
      success: false,
      error: messages.projects.errors.typeName,
    });
  });
});
