import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  /** Results returned, in order, by each `publicDb.select()...limit()` chain. */
  selectQueue: [] as unknown[][],
  selectResolver: null as null | ((table: unknown, where: unknown) => unknown[]),
  selectCalls: 0,
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  insertHandler: null as null | ((table: unknown, values: unknown) => void),
  updateCalls: [] as Array<{
    table: unknown;
    values: unknown;
    where: unknown;
  }>,
  updateHandler: null as null | ((call: {
    table: unknown;
    values: unknown;
    where: unknown;
  }) => void),
  updateError: null as Error | null,
  sendEmail: vi.fn(async () => ({ success: true as const })),
  getEmailT: vi.fn(async () => (key: string) => key),
  cacheCalls: [] as Array<{
    keyParts: string[];
    options: { revalidate: number; tags: string[] };
  }>,
  addMembershipAndActivate: vi.fn(async () => {}),
  hasModule: vi.fn(),
  signUpEmail: vi.fn(async () => ({ user: { id: "new-user" } })),
  getSession: vi.fn(async () => ({
    user: { id: "existing-user", email: "pat@example.com", name: "Pat" },
  })),
}));

type SelectQueryMock = {
  from: (...args: unknown[]) => SelectQueryMock;
  innerJoin: (...args: unknown[]) => SelectQueryMock;
  where: (...args: unknown[]) => SelectQueryMock;
  limit: (...args: unknown[]) => Promise<unknown[]>;
  orderBy: (...args: unknown[]) => Promise<unknown[]>;
};

vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => {
      h.selectCalls += 1;
      let table: unknown;
      let where: unknown;
      const query: SelectQueryMock = {
        from: (...args: unknown[]) => {
          table = args[0];
          return query;
        },
        innerJoin: () => query,
        where: (...args: unknown[]) => {
          where = args[0];
          return query;
        },
        limit: async () =>
          h.selectResolver?.(table, where) ?? h.selectQueue.shift() ?? [],
        orderBy: async () =>
          h.selectResolver?.(table, where) ?? h.selectQueue.shift() ?? [],
      };
      return query;
    },
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        h.insertCalls.push({ table, values });
        h.insertHandler?.(table, values);
        return [];
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async (where: unknown) => {
          const call = { table, values, where };
          h.updateCalls.push(call);
          if (h.updateError) throw h.updateError;
          h.updateHandler?.(call);
          return [];
        },
      }),
    }),
  },
}));
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
vi.mock("@/lib/email/send", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/branding", () => ({
  getEmailBranding: vi.fn(async () => ({
    businessName: "Business X",
    logoUrl: null,
    brandColor: "#000000",
  })),
}));
vi.mock("@/lib/terms/email", () => ({ getEmailT: h.getEmailT }));
vi.mock("@/lib/tenant/industry", () => ({
  getTenantTerms: vi.fn(async () => ({ staff: { one: "stylist" } })),
}));
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
  unstable_cache: (
    fn: () => unknown,
    keyParts: string[],
    options: { revalidate: number; tags: string[] },
  ) => {
    h.cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

vi.mock("@/lib/tenant/modules", () => ({ hasModule: h.hasModule }));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (k: string) => k,
}));

import { teamInvitations } from "@/lib/db/schema/team-invitations";

import { requireRole } from "@/lib/auth/rbac";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import {
  acceptInvitation,
  getInvitationByToken,
  joinBusinessFromInvitation,
  listUserMemberships,
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
        tenantSlug: "business-x",
        status: "pending",
        expiresAt: future,
      },
    ],
    [{ name: "Business X" }],
  ];
}

describe("listUserMemberships", () => {
  beforeEach(() => {
    h.selectQueue = [];
    h.selectCalls = 0;
    h.cacheCalls = [];
  });

  it("returns business names and active tenant while retaining scoped cache settings", async () => {
    h.getSession.mockResolvedValueOnce({
      user: {
        id: "membership-user",
        email: "member@example.com",
        name: "Member",
      },
    });
    h.selectQueue = [
      [{ tenantSlug: "business-a" }],
      [
        {
          tenantSlug: "business-a",
          role: "owner",
          businessName: "Northwind Hair",
        },
        {
          tenantSlug: "business-b",
          role: "provider",
          businessName: "Northwind Barbers",
        },
      ],
    ];

    await expect(listUserMemberships()).resolves.toEqual({
      memberships: [
        {
          tenantSlug: "business-a",
          role: "owner",
          businessName: "Northwind Hair",
        },
        {
          tenantSlug: "business-b",
          role: "provider",
          businessName: "Northwind Barbers",
        },
      ],
      activeTenantSlug: "business-a",
    });
    expect(h.selectCalls).toBe(2);
    expect(h.cacheCalls).toEqual([
      {
        keyParts: ["user-memberships-v2", "membership-user"],
        options: {
          revalidate: 60,
          tags: ["user:membership-user:memberships"],
        },
      },
    ]);
  });

  it("returns an empty result without querying the database when unauthenticated", async () => {
    h.getSession.mockResolvedValueOnce(null as never);

    await expect(listUserMemberships()).resolves.toEqual({
      memberships: [],
      activeTenantSlug: null,
    });
    expect(h.selectCalls).toBe(0);
    expect(h.cacheCalls).toEqual([]);
  });
});

describe("getInvitationByToken", () => {
  it("returns the business name for invitation display", async () => {
    h.selectQueue = [...invitationRows("provider")];

    await expect(getInvitationByToken("tok")).resolves.toMatchObject({
      invitation: { tenantSlug: "business-x" },
      businessName: "Business X",
    });
  });
});

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
    expect(result).toEqual({ success: true, tenantSlug: "business-x" });
    expect(h.addMembershipAndActivate).toHaveBeenCalledWith(
      "new-user",
      "business-x",
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
    expect(result).toEqual({ success: true, tenantSlug: "business-x" });
    expect(h.addMembershipAndActivate).toHaveBeenCalledWith(
      "existing-user",
      "business-x",
      expected,
    );
  });
});

describe("sendInvitation assistant gating", () => {
  it("refuses assistant invites when the assistant_tasks module is off", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      userId: "u",
      role: "owner",
      tenantSlug: "business-x",
    } as never);
    h.hasModule.mockResolvedValue(false);
    const result = await sendInvitation({ email: "a@b.co", role: "assistant" });
    expect(result).toEqual({ success: false, error: "team.assistantsDisabled" });
    expect(h.hasModule).toHaveBeenCalledWith("business-x", "assistant_tasks");
  });
});

type InvitationRow = {
  id: string;
  token: string;
  email: string;
  tenantSlug: string;
  status: string;
  expiresAt: Date;
};

function makeInvitationDatabase(email: string) {
  const rows: InvitationRow[] = [
    {
      id: "other-tenant",
      token: "other-tenant-token",
      email,
      tenantSlug: "business-y",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    {
      id: "other-token",
      token: "other-token-value",
      email: "colleague@example.com",
      tenantSlug: "business-x",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
    {
      id: "processed",
      token: "processed-token",
      email,
      tenantSlug: "business-x",
      status: "accepted",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  ];
  const dialect = new PgDialect();

  h.selectResolver = (table, where) => {
    if (!table || getTableName(table as Parameters<typeof getTableName>[0]) !== "team_invitations") {
      if (table && getTableName(table as Parameters<typeof getTableName>[0]) === "user") {
        return [{ name: "Owner" }];
      }
      if (table && getTableName(table as Parameters<typeof getTableName>[0]) === "tenants") {
        return [{ name: "Business X" }];
      }
      return [];
    }
    const { params } = dialect.sqlToQuery(where as SQL);
    const [inviteEmail, tenantSlug, status] = params as string[];
    return rows
      .filter(
        (row) =>
          row.email === inviteEmail &&
          row.tenantSlug === tenantSlug &&
          row.status === status,
      )
      .map(({ id }) => ({ id }));
  };
  h.insertHandler = (table, values) => {
    if (getTableName(table as Parameters<typeof getTableName>[0]) !== "team_invitations") return;
    const invitation = values as {
      token: string;
      email: string;
      tenantSlug: string;
      expiresAt: Date;
    };
    rows.push({
      id: `inserted-${rows.length}`,
      ...invitation,
      status: "pending",
    });
  };
  h.updateHandler = ({ table, values, where }) => {
    expect(getTableName(table as Parameters<typeof getTableName>[0])).toBe("team_invitations");
    const { params } = dialect.sqlToQuery(where as SQL);
    const [token, tenantSlug, status] = params as string[];
    for (const row of rows) {
      if (
        row.token === token &&
        row.tenantSlug === tenantSlug &&
        row.status === status
      ) {
        Object.assign(row, values);
      }
    }
  };

  return rows;
}

describe("sendInvitation delivery result", () => {
  const email = "new-provider@example.com";

  beforeEach(() => {
    h.selectQueue = [];
    h.selectResolver = null;
    h.insertCalls = [];
    h.insertHandler = null;
    h.updateCalls = [];
    h.updateHandler = null;
    h.updateError = null;
    h.selectCalls = 0;
    h.sendEmail.mockReset();
    h.sendEmail.mockResolvedValue({ success: true });
    vi.mocked(trackEvent).mockClear();
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(requireRole).mockResolvedValue({
      userId: "owner-user",
      role: "owner",
      tenantSlug: "business-x",
    } as never);
  });

  it("returns success and emits team.invited after a delivered email", async () => {
    h.selectQueue = [[], [], [{ name: "Owner" }], [{ name: "Business X" }]];

    await expect(sendInvitation({ email, role: "provider" })).resolves.toEqual({
      success: true,
    });

    expect(h.insertCalls).toHaveLength(1);
    expect(h.insertCalls[0].table).toBe(teamInvitations);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.updateCalls).toEqual([]);
    expect(trackEvent).toHaveBeenCalledWith(
      "team.invited",
      { role: "provider" },
      { tenantSlug: "business-x" },
    );
  });

  it("expires only the new pending invitation when delivery fails", async () => {
    const rows = makeInvitationDatabase(email);
    h.sendEmail.mockResolvedValue({ success: false, error: "provider secret" } as never);

    await expect(sendInvitation({ email, role: "provider" })).resolves.toEqual({
      success: false,
      error: "Could not send the invitation. Please try again.",
    });

    expect(h.updateCalls).toHaveLength(1);
    const update = h.updateCalls[0];
    expect(getTableName(update.table as Parameters<typeof getTableName>[0])).toBe("team_invitations");
    expect(update.values).toEqual({
      status: "expired",
      expiresAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    const where = new PgDialect().sqlToQuery(update.where as SQL);
    expect(where.sql).toContain('"team_invitations"."token"');
    expect(where.sql).toContain('"team_invitations"."tenant_slug"');
    expect(where.sql).toContain('"team_invitations"."status"');
    expect(where.params).toEqual([
      (h.insertCalls[0].values as { token: string }).token,
      "business-x",
      "pending",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/team");
    expect(rows).toMatchObject([
      { id: "other-tenant", status: "pending" },
      { id: "other-token", status: "pending" },
      { id: "processed", status: "accepted" },
      { status: "expired", tenantSlug: "business-x", email },
    ]);
    expect(trackEvent).not.toHaveBeenCalledWith(
      "team.invited",
      expect.anything(),
      expect.anything(),
    );
  });

  it("allows a fresh invitation after a failed delivery was expired", async () => {
    const rows = makeInvitationDatabase(email);
    h.sendEmail
      .mockResolvedValueOnce({ success: false, error: "provider secret" } as never)
      .mockResolvedValueOnce({ success: true } as never);

    await expect(sendInvitation({ email, role: "provider" })).resolves.toMatchObject({
      success: false,
      error: "Could not send the invitation. Please try again.",
    });
    await expect(sendInvitation({ email, role: "provider" })).resolves.toEqual({
      success: true,
    });

    expect(
      rows.filter(
        (row) => row.email === email && row.tenantSlug === "business-x",
      ),
    ).toMatchObject([
      { id: "processed", status: "accepted" },
      { status: "expired" },
      { status: "pending" },
    ]);
    expect(h.insertCalls).toHaveLength(2);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("returns failure if the expiry update fails and does not claim invitation success", async () => {
    const rows = makeInvitationDatabase(email);
    h.sendEmail.mockResolvedValue({ success: false, error: "provider secret" } as never);
    h.updateError = new Error("expiry write failed");

    const result = await sendInvitation({ email, role: "provider" });

    expect(result).toEqual({ success: false, error: "expiry write failed" });
    expect(revalidatePath).not.toHaveBeenCalledWith("/settings/team");
    expect(rows).toMatchObject([
      { id: "other-tenant", status: "pending" },
      { id: "other-token", status: "pending" },
      { id: "processed", status: "accepted" },
      { status: "pending", email, tenantSlug: "business-x" },
    ]);
    expect(trackEvent).not.toHaveBeenCalledWith(
      "team.invited",
      expect.anything(),
      expect.anything(),
    );
  });
});
