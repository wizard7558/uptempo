import { beforeEach, describe, expect, it, vi } from "vitest";

const getTenantSlugMock = vi.fn();
const withTenantDbMock = vi.fn();

function makeSqlResult(strings: TemplateStringsArray, values: unknown[]) {
  return {
    strings: Array.from(strings),
    values,
    as(alias: string) {
      return { strings: this.strings, values: this.values, alias };
    },
  };
}

const sqlMock = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) =>
    makeSqlResult(strings, values),
  {
    raw: (value: string) => ({ raw: value }),
  },
);

vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: getTenantSlugMock,
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => ({
    userId: "u",
    role: "owner",
    tenantSlug: "test-salon",
  }),
  AuthError: class AuthError extends Error {
    code = "FORBIDDEN";
  },
}));

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: withTenantDbMock,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    sql: sqlMock,
    eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    ne: vi.fn((...args: unknown[]) => ({ op: "ne", args })),
    gte: vi.fn((...args: unknown[]) => ({ op: "gte", args })),
    lte: vi.fn((...args: unknown[]) => ({ op: "lte", args })),
  };
});

describe("getStaffUtilization SQL compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenantSlugMock.mockResolvedValue("test-salon");
  });

  it("uses range bounds instead of width(tstzrange)", async () => {
    const selectCalls: unknown[] = [];

    const firstQuery = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([]),
    };

    const secondQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    const thirdQuery = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    const db = {
      select: vi
        .fn()
        .mockImplementation((arg: unknown) => {
          selectCalls.push(arg);
          if (selectCalls.length === 1) return firstQuery;
          if (selectCalls.length === 2) return secondQuery;
          return thirdQuery;
        }),
    };

    const tables = {
      appointments: {
        staffId: "appointments.staff_id",
        during: "appointments.during",
        status: "appointments.status",
      },
      staff: {
        id: "staff.id",
        displayName: "staff.display_name",
      },
      workingHours: {
        staffId: "working_hours.staff_id",
        dayOfWeek: "working_hours.day_of_week",
        startTime: "working_hours.start_time",
        endTime: "working_hours.end_time",
        isEnabled: "working_hours.is_enabled",
      },
    };

    withTenantDbMock.mockImplementation(
      async (_slug: string, callback: (dbArg: unknown, tablesArg: unknown) => unknown) =>
        callback(db, tables),
    );

    const { getStaffUtilization } = await import("./analytics");
    await getStaffUtilization({
      start: new Date("2026-04-01T00:00:00.000Z"),
      end: new Date("2026-04-30T23:59:59.000Z"),
    });

    const firstSelectArg = selectCalls[0] as {
      bookedMinutes: { strings: string[] };
    };
    const bookedMinutesSql = firstSelectArg.bookedMinutes.strings.join(" ");

    expect(bookedMinutesSql).toContain("upper(");
    expect(bookedMinutesSql).toContain("lower(");
    expect(bookedMinutesSql).not.toContain("width(");
  });
});
