import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Results returned, in order, by each `publicDb.select()...limit()` chain. */
  selectQueue: [] as unknown[][],
  addMembershipAndActivate: vi.fn(async () => {}),
  hasModule: vi.fn(),
  signUpEmail: vi.fn(async () => ({ user: { id: "new-user" } })),
  getSession: vi.fn(async () => ({
    user: { id: "existing-user", email: "pat@example.com", name: "Pat" },
  })),
}));

vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => h.selectQueue.shift() ?? [] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock("@/lib/db/schema/team-invitations", () => ({ teamInvitations: {} }));
vi.mock("@/lib/db/schema/auth", () => ({ user: {} }));
vi.mock("@/lib/db/schema/tenants", () => ({ tenants: {} }));
vi.mock("@/lib/db/schema/memberships", () => ({ memberships: {} }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: vi.fn(),
  AuthError: class AuthError extends Error {
    code = "FORBIDDEN";
  },
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { signUpEmail: h.signUpEmail, getSession: h.getSession } },
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: vi.fn() }));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("@/emails/team-invite", () => ({ TeamInviteEmail: vi.fn() }));
vi.mock("@/lib/utils", () => ({ getBaseUrl: () => "http://localhost" }));
vi.mock("@/lib/analytics/events", () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
}));
vi.mock("@/lib/db/membership-helpers", () => ({
  addMembershipAndActivate: h.addMembershipAndActivate,
  setActiveTenantForUser: vi.fn(async () => {}),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: () => unknown) => fn,
}));

vi.mock("@/lib/tenant/modules", () => ({ hasModule: h.hasModule }));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (k: string) => k,
}));

import { requireRole } from "@/lib/auth/rbac";
import {
  acceptInvitation,
  joinBusinessFromInvitation,
  sendInvitation,
} from "./team";

function invitationRows(role: string) {
  const future = new Date(Date.now() + 60_000);
  return [
    [
      {
        id: "inv-1",
        email: "pat@example.com",
        role,
        tenantSlug: "salon-x",
        status: "pending",
        expiresAt: future,
      },
    ],
    [{ name: "Salon X" }],
  ];
}

describe("invitation accept normalizes the role", () => {
  beforeEach(() => {
    h.selectQueue = [];
    h.addMembershipAndActivate.mockClear();
  });

  it.each([
    ["stylist", "provider"],
    ["provider", "provider"],
    ["assistant", "assistant"],
  ])("acceptInvitation stores %s as %s", async (stored, expected) => {
    // invitation lookup, tenant name, then "existing account" check (none)
    h.selectQueue = [...invitationRows(stored), []];
    const result = await acceptInvitation("tok", {
      name: "Pat",
      email: "pat@example.com",
      password: "pw-12345678",
    });
    expect(result).toEqual({ success: true, tenantSlug: "salon-x" });
    expect(h.addMembershipAndActivate).toHaveBeenCalledWith(
      "new-user",
      "salon-x",
      expected,
    );
  });

  it.each([
    ["stylist", "provider"],
    ["provider", "provider"],
  ])("joinBusinessFromInvitation stores %s as %s", async (stored, expected) => {
    // invitation lookup, tenant name, then duplicate-membership check (none)
    h.selectQueue = [...invitationRows(stored), []];
    const result = await joinBusinessFromInvitation("tok");
    expect(result).toEqual({ success: true, tenantSlug: "salon-x" });
    expect(h.addMembershipAndActivate).toHaveBeenCalledWith(
      "existing-user",
      "salon-x",
      expected,
    );
  });
});

describe("sendInvitation assistant gating", () => {
  it("refuses assistant invites when the assistant_tasks module is off", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      userId: "u",
      role: "owner",
      tenantSlug: "salon-x",
    } as never);
    h.hasModule.mockResolvedValue(false);
    const result = await sendInvitation({ email: "a@b.co", role: "assistant" });
    expect(result).toEqual({ success: false, error: "team.assistantsDisabled" });
    expect(h.hasModule).toHaveBeenCalledWith("salon-x", "assistant_tasks");
  });
});
