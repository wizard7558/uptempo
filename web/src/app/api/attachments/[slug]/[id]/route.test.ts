import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// db.select(...).from(...).where(...).limit(...) resolves to the rows `execute` returns.
const execute = vi.fn();
const chain = { select: () => chain, from: () => chain, where: () => chain, limit: () => execute() };
const tables = { attachments: { id: "id", kind: "kind", storageKey: "sk", deletedAt: "da" } };
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: (_slug: string, cb: (db: unknown, t: unknown) => unknown) => cb(chain, tables),
}));
const getActiveStaffRole = vi.fn();
vi.mock("@/lib/auth/rbac", () => ({ getActiveStaffRole: () => getActiveStaffRole() }));
const getSignedReadUrl = vi.fn();
vi.mock("@/lib/providers/storage", () => ({
  getStorageProvider: () => ({ getSignedReadUrl }),
}));

import { signFileLink } from "@/lib/storage/file-links";
import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

function call(slug: string, link = signFileLink(slug, ID)) {
  return GET(new Request(`http://localhost:3000${link}`), {
    params: Promise.resolve({ slug, id: ID }),
  });
}

beforeEach(() => {
  vi.stubEnv("BOOKING_SESSION_SECRET", "test-secret");
  execute.mockReset();
  getActiveStaffRole.mockReset();
  getSignedReadUrl.mockReset();
  getSignedReadUrl.mockResolvedValue("https://files.example/signed?x=1");
});
afterEach(() => vi.unstubAllEnvs());

const idRow = [{ kind: "id_document", storageKey: "private/k.jpg" }];
const refRow = [{ kind: "reference", storageKey: "private/r.png" }];

describe("GET /api/attachments/[slug]/[id]", () => {
  it("403s an expired or tampered link before touching the database", async () => {
    const link = signFileLink("acme", ID, 300, Date.now() - 400_000);
    const res = await call("acme", link);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Link expired" });
    expect(execute).not.toHaveBeenCalled();
    expect((await call("acme", signFileLink("other", ID))).status).toBe(403);
  });

  it("404s a missing or deleted attachment", async () => {
    execute.mockResolvedValue([]);
    expect((await call("acme")).status).toBe(404);
  });

  it("id_document with no staff session is 403", async () => {
    execute.mockResolvedValue(idRow);
    getActiveStaffRole.mockResolvedValue(null);
    expect((await call("acme")).status).toBe(403);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("id_document with staff of another tenant is 403", async () => {
    execute.mockResolvedValue(idRow);
    getActiveStaffRole.mockResolvedValue({ userId: "u", role: "owner", tenantSlug: "other" });
    expect((await call("acme")).status).toBe(403);
    expect(getSignedReadUrl).not.toHaveBeenCalled();
  });

  it("id_document with an assistant is 403", async () => {
    execute.mockResolvedValue(idRow);
    getActiveStaffRole.mockResolvedValue({ userId: "u", role: "assistant", tenantSlug: "acme" });
    expect((await call("acme")).status).toBe(403);
  });

  it("id_document with staff of this tenant redirects to a 60 second read URL", async () => {
    execute.mockResolvedValue(idRow);
    getActiveStaffRole.mockResolvedValue({ userId: "u", role: "provider", tenantSlug: "acme" });
    const res = await call("acme");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://files.example/signed?x=1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(getSignedReadUrl).toHaveBeenCalledWith("private/k.jpg", 60);
  });

  it("a reference file needs only a valid link", async () => {
    execute.mockResolvedValue(refRow);
    const res = await call("acme");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(getActiveStaffRole).not.toHaveBeenCalled();
  });

  it("503s when storage cannot sign", async () => {
    execute.mockResolvedValue(refRow);
    getSignedReadUrl.mockRejectedValue(new Error("nope"));
    expect((await call("acme")).status).toBe(503);
  });
});
