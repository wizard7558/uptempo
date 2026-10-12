import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
const deleteByKey = vi.fn();
const insertValues = vi.fn();

vi.mock("@/lib/providers/storage", () => ({
  getStorageProvider: () => ({ put, deleteByKey }),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (_slug: string, fn: (db: unknown, t: unknown) => unknown) =>
    fn({ insert: () => ({ values: insertValues }) }, { attachments: {} }),
}));

import { AttachmentError, createAttachment } from "./service";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const base = {
  slug: "acme",
  ownerType: "request" as const,
  ownerId: null,
  clientId: null,
  kind: "reference" as const,
  uploadedBy: "client:1",
  deleteAfter: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({ url: "http://x/private/k", key: "private/t/acme/request/2026/10/k.png" });
  insertValues.mockResolvedValue(undefined);
  deleteByKey.mockResolvedValue(undefined);
});

describe("createAttachment", () => {
  it("rejects an empty file and an oversize file before storing anything", async () => {
    await expect(createAttachment({ ...base, file: new File([], "a.png") })).rejects.toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
    });
    const big = new File([Buffer.alloc(7 * 1024 * 1024 + 1, 1)], "big.png");
    await expect(createAttachment({ ...base, file: big })).rejects.toBeInstanceOf(AttachmentError);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not an allowed type, whatever the browser says", async () => {
    const file = new File(["<html>"], "x.png", { type: "image/png" });
    await expect(createAttachment({ ...base, file })).rejects.toMatchObject({ code: "ATTACHMENT_TYPE" });
    expect(put).not.toHaveBeenCalled();
  });

  it("stores privately under the tenant and request prefix and records the key", async () => {
    const { id } = await createAttachment({ ...base, file: new File([PNG], "a.png") });
    const call = put.mock.calls[0][0];
    expect(call.visibility).toBe("private");
    expect(call.key).toMatch(new RegExp(`^t/acme/request/\\d{4}/\\d{2}/${id}\\.png$`));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id, storageKey: "private/t/acme/request/2026/10/k.png", mime: "image/png", isPrivate: 1 }),
    );
  });

  it("removes the stored file when the row cannot be saved", async () => {
    insertValues.mockRejectedValue(new Error("db down"));
    await expect(createAttachment({ ...base, file: new File([PNG], "a.png") })).rejects.toThrow("db down");
    expect(deleteByKey).toHaveBeenCalledWith("private/t/acme/request/2026/10/k.png");
  });
});
