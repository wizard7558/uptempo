// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class AttachmentError extends Error {
    code: "ATTACHMENT_TOO_LARGE" | "ATTACHMENT_TYPE";
    constructor(code: "ATTACHMENT_TOO_LARGE" | "ATTACHMENT_TYPE") {
      super(code);
      this.name = "AttachmentError";
      this.code = code;
    }
  }
  return {
    AttachmentError,
    requireRole: vi.fn(),
    assertModule: vi.fn(),
    createAttachment: vi.fn(),
    appointmentClientId: vi.fn(),
  };
});

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: (...args: unknown[]) => h.requireRole(...args),
}));
vi.mock("@/lib/tenant/modules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant/modules")>();
  return {
    ...actual,
    assertModule: (...args: unknown[]) => h.assertModule(...args),
  };
});
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) =>
    (
      {
        "photos.tooBig": "That photo is too large. Try a smaller one.",
        "photos.type": "Choose a JPG, PNG, WebP, or HEIC photo.",
        "photos.failed": "Couldn't upload the photo. Please try again.",
      } as Record<string, string>
    )[key] ?? key,
}));
vi.mock("@/lib/attachments/service", () => ({
  AttachmentError: h.AttachmentError,
  createAttachment: (...args: unknown[]) => h.createAttachment(...args),
}));
vi.mock("@/lib/photos/appointment-photos", () => ({
  appointmentClientId: (...args: unknown[]) => h.appointmentClientId(...args),
}));

import { ModuleDisabledError } from "@/lib/tenant/modules";
import { POST } from "./route";

const APPOINTMENT = "22222222-2222-4222-8222-222222222222";
const CLIENT = "55555555-5555-4555-8555-555555555555";

function upload(file: File, kind = "before") {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);
  return POST(new Request("http://localhost/api/appointments/photos", { method: "POST", body }), {
    params: Promise.resolve({ id: APPOINTMENT }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({ userId: "u1", role: "provider", tenantSlug: "acme" });
  h.assertModule.mockResolvedValue(undefined);
  h.appointmentClientId.mockResolvedValue(CLIENT);
  h.createAttachment.mockResolvedValue({ id: "photo-1" });
});

describe("POST /api/appointments/[id]/photos", () => {
  it("stores a jpeg through createAttachment", async () => {
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "before.jpg", {
      type: "image/jpeg",
    });
    const res = await upload(file);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "photo-1" });
    expect(h.requireRole).toHaveBeenCalledWith("owner", "admin", "provider", "assistant");
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(h.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "acme",
        ownerType: "appointment",
        ownerId: APPOINTMENT,
        clientId: CLIENT,
        kind: "before",
        uploadedBy: "u1",
        deleteAfter: null,
      }),
    );
  });

  it("rejects a 5 MB file before storing it", async () => {
    const file = new File([new Uint8Array(5_000_000)], "big.jpg", { type: "image/jpeg" });
    const res = await upload(file);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That photo is too large. Try a smaller one." });
    expect(h.createAttachment).not.toHaveBeenCalled();
  });

  it("rejects a text file before storing it", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const res = await upload(file);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Choose a JPG, PNG, WebP, or HEIC photo." });
    expect(h.createAttachment).not.toHaveBeenCalled();
  });

  it("returns 415 when the stored bytes are not a photo", async () => {
    h.createAttachment.mockRejectedValue(new h.AttachmentError("ATTACHMENT_TYPE"));
    const file = new File([Uint8Array.from([1, 2, 3])], "anim.gif", { type: "image/gif" });
    const res = await upload(file);
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Choose a JPG, PNG, WebP, or HEIC photo." });
    expect(h.createAttachment).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when the session has no business and does not store the file", async () => {
    h.requireRole.mockResolvedValue({ userId: "u1", role: "provider", tenantSlug: null });
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "before.jpg", { type: "image/jpeg" });
    const res = await upload(file);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to a business first." });
    expect(h.appointmentClientId).not.toHaveBeenCalled();
    expect(h.createAttachment).not.toHaveBeenCalled();
  });

  it("returns 403 when photos are turned off", async () => {
    h.assertModule.mockRejectedValue(
      new ModuleDisabledError("attachments", "Photos and checklists is off"),
    );
    const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "before.jpg", { type: "image/jpeg" });
    const res = await upload(file);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Photos and checklists is off" });
    expect(h.createAttachment).not.toHaveBeenCalled();
  });
});
