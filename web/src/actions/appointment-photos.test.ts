// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  assertModule: vi.fn(),
  listRecords: vi.fn(),
  findPhoto: vi.fn(),
  markDeleted: vi.fn(),
  deleteByKey: vi.fn(),
  signFileLink: vi.fn(),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: (...args: unknown[]) => h.requireStaff(...args),
}));
vi.mock("@/lib/tenant/modules", () => ({
  assertModule: (...args: unknown[]) => h.assertModule(...args),
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) =>
    (
      {
        "photos.notFound": "That photo is already gone.",
        "photos.notAllowed": "You can only delete a photo you added in the last 24 hours.",
      } as Record<string, string>
    )[key] ?? key,
}));
vi.mock("@/lib/photos/appointment-photos", () => ({
  listAppointmentPhotoRecords: (...args: unknown[]) => h.listRecords(...args),
  findAppointmentPhoto: (...args: unknown[]) => h.findPhoto(...args),
  markAppointmentPhotoDeleted: (...args: unknown[]) => h.markDeleted(...args),
}));
vi.mock("@/lib/storage/file-links", () => ({
  signFileLink: (...args: unknown[]) => h.signFileLink(...args),
}));
vi.mock("@/lib/providers/storage", () => ({
  getStorageProvider: () => ({ deleteByKey: (...args: unknown[]) => h.deleteByKey(...args) }),
}));

import { deleteAppointmentPhoto, listAppointmentPhotos } from "./appointment-photos";

const TEAM = ["owner", "admin", "provider", "assistant"];
const PHOTO = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT = "22222222-2222-4222-8222-222222222222";
const STORAGE_KEY = "t/acme/appointment/2026/10/left.jpg";

beforeEach(() => {
  vi.clearAllMocks();
  h.requireStaff.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "acme" });
  h.assertModule.mockResolvedValue(undefined);
  h.deleteByKey.mockResolvedValue(undefined);
  h.markDeleted.mockResolvedValue(undefined);
  h.signFileLink.mockImplementation(
    (slug: string, id: string, ttl: number) => `/api/attachments/${slug}/${id}?ttl=${ttl}`,
  );
});

describe("appointment photo actions", () => {
  it("lists photos newest first with a 10 minute signed link", async () => {
    h.listRecords.mockResolvedValue([
      {
        id: PHOTO,
        kind: "before",
        caption: "Left side",
        storageKey: STORAGE_KEY,
        uploadedBy: "someone-else",
        createdAt: new Date("2026-10-11T15:00:00.000Z"),
      },
    ]);
    const rows = await listAppointmentPhotos(APPOINTMENT);
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(h.assertModule).toHaveBeenCalledWith("acme", "attachments");
    expect(h.signFileLink).toHaveBeenCalledWith("acme", PHOTO, 600);
    expect(rows).toEqual([
      {
        id: PHOTO,
        kind: "before",
        caption: "Left side",
        url: `/api/attachments/acme/${PHOTO}?ttl=600`,
        createdAt: "2026-10-11T15:00:00.000Z",
        canDelete: true,
      },
    ]);
  });

  it("deletes a photo the owner may remove and leaves the file when the rule refuses", async () => {
    h.findPhoto.mockResolvedValue({
      id: PHOTO,
      kind: "before",
      caption: null,
      storageKey: STORAGE_KEY,
      uploadedBy: "someone-else",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const removed = await deleteAppointmentPhoto({ attachmentId: PHOTO });
    expect(h.requireStaff).toHaveBeenCalledWith(...TEAM);
    expect(removed).toEqual({ ok: true });
    expect(h.deleteByKey).toHaveBeenCalledWith(STORAGE_KEY);
    expect(h.markDeleted).toHaveBeenCalledWith("acme", PHOTO);

    h.requireStaff.mockResolvedValue({ userId: "u1", role: "provider", tenantSlug: "acme" });
    h.findPhoto.mockResolvedValue({
      id: PHOTO,
      kind: "before",
      caption: null,
      storageKey: STORAGE_KEY,
      uploadedBy: "u1",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const refused = await deleteAppointmentPhoto({ attachmentId: PHOTO });
    expect(refused).toEqual({
      ok: false,
      error: "You can only delete a photo you added in the last 24 hours.",
    });
    expect(h.deleteByKey).toHaveBeenCalledTimes(1);
    expect(h.markDeleted).toHaveBeenCalledTimes(1);
  });
});
