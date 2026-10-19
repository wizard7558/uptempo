"use server";

import { syncBillableStaff } from "@/lib/billing/billable-staff";
import { getT } from "@/lib/terms/server";
import { withTenantDb } from "@/lib/db/tenant";
import {
  createStaffSchema,
  updateStaffSchema,
} from "@/lib/validators/staff";
import { eq, and, asc, gt } from "drizzle-orm";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { addDays, wallClockToDate } from "@/lib/scheduling/intervals";
import { revalidatePath } from "next/cache";
import { getServicesForStaff } from "@/lib/queries/staff-services";
import { trackEvent } from "@/lib/analytics/events";

export async function createStaffMember(data: {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  serviceIds?: string[];
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createStaffSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const result = await withTenantDb(slug, async (db, { staff, staffServices }) => {
      return db.transaction(async (tx) => {
        const [staffMember] = await tx
          .insert(staff)
          .values({
            displayName: parsed.data.displayName,
            email: parsed.data.email ?? null,
            phone: parsed.data.phone ?? null,
          })
          .returning({ id: staff.id });

        if (parsed.data.serviceIds && parsed.data.serviceIds.length > 0) {
          await tx.insert(staffServices).values(
            parsed.data.serviceIds.map((serviceId) => ({
              staffId: staffMember.id,
              serviceId,
            })),
          );
        }

        return staffMember;
      });
    });
    await syncBillableStaff(slug);

    revalidatePath("/settings/staff");
    trackEvent("stylist.created", {}, { tenantSlug: slug });
    return { success: true as const, id: result.id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: (await getT("errors"))("staff.createFailed"),
      },
    };
  }
}

export async function updateStaffMember(data: {
  id: string;
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  defaultAssistantId?: string | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateStaffSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const { id, defaultAssistantId, ...rest } = parsed.data;

    if (defaultAssistantId !== undefined) {
      const allowed = await withTenantDb(slug, async (db, { staff }) => {
        const [self] = await db
          .select({ role: staff.role })
          .from(staff)
          .where(eq(staff.id, id))
          .limit(1);
        if (self?.role === "assistant" && defaultAssistantId !== null) {
          return false;
        }
        if (defaultAssistantId === null) {
          return true;
        }
        if (defaultAssistantId === id) {
          return false;
        }
        const [asst] = await db
          .select({ role: staff.role, isActive: staff.isActive })
          .from(staff)
          .where(eq(staff.id, defaultAssistantId))
          .limit(1);
        return (
          !!asst &&
          asst.role === "assistant" &&
          asst.isActive === 1
        );
      });
      if (!allowed) {
        return {
          success: false as const,
          error: {
            formErrors: [],
            fieldErrors: {},
            message: "Choose an active assistant, or clear the field",
          },
        };
      }
    }

    const updates = {
      ...rest,
      ...(defaultAssistantId !== undefined
        ? { defaultAssistantId }
        : {}),
    };

    const result = await withTenantDb(slug, async (db, { staff }) => {
      return db
        .update(staff)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(staff.id, id), eq(staff.isActive, 1)))
        .returning({ id: staff.id });
    });
    await syncBillableStaff(slug);

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: (await getT("errors", slug))("staff.notFoundOrInactive"),
        },
      };
    }

    revalidatePath("/settings/staff");
    trackEvent("stylist.updated", {}, { tenantSlug: slug });
    return { success: true as const, id: result[0].id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: (await getT("errors"))("staff.updateFailed"),
      },
    };
  }
}

/**
 * Set (or clear) a staff member's Capacity Coach goals. `targetHoursPerWeek` is whole
 * hours; `targetHourlyEarningsCents` is the take-home/hour goal in cents. Pass
 * `null` for either to clear it. Both must be set for the coach to evaluate.
 */
export async function updateStaffGoals(data: {
  id: string;
  targetHoursPerWeek: number | null;
  targetHourlyEarningsCents: number | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const { id, targetHoursPerWeek, targetHourlyEarningsCents } = data;

  if (typeof id !== "string" || id.length === 0) {
    return { success: false as const, message: (await getT("errors"))("staff.missingId") };
  }
  const validHours =
    targetHoursPerWeek === null ||
    (Number.isInteger(targetHoursPerWeek) &&
      targetHoursPerWeek >= 1 &&
      targetHoursPerWeek <= 168);
  const validRate =
    targetHourlyEarningsCents === null ||
    (Number.isInteger(targetHourlyEarningsCents) &&
      targetHourlyEarningsCents >= 0 &&
      targetHourlyEarningsCents <= 1_000_00);
  if (!validHours || !validRate) {
    return { success: false as const, message: "Enter valid goal values" };
  }

  try {
    const result = await withTenantDb(slug, async (db, { staff }) => {
      return db
        .update(staff)
        .set({
          targetHoursPerWeek,
          targetHourlyEarningsCents,
          updatedAt: new Date(),
        })
        .where(and(eq(staff.id, id), eq(staff.isActive, 1)))
        .returning({ id: staff.id });
    });
    await syncBillableStaff(slug);
    if (result.length === 0) {
      return {
        success: false as const,
        message: (await getT("errors", slug))("staff.notFound"),
      };
    }
    revalidatePath("/settings/staff");
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return { success: false as const, message: "Failed to save goals" };
  }
}

export async function deactivateStaffMember(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {
    const result = await withTenantDb(slug, async (db, { staff }) => {
      return db
        .update(staff)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(staff.id, id))
        .returning({ id: staff.id });
    });
    await syncBillableStaff(slug);

    if (result.length === 0) {
      return {
        success: false as const,
        error: { message: (await getT("errors", slug))("staff.notFound") },
      };
    }

    revalidatePath("/settings/staff");
    trackEvent("stylist.deleted", {}, { tenantSlug: slug });
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { message: (await getT("errors"))("staff.deactivateFailed") },
    };
  }
}

export async function listStaff() {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { staff, staffServices, services }) => {
    const allStaff = await db
      .select()
      .from(staff)
      .where(eq(staff.isActive, 1))
      .orderBy(asc(staff.displayName));

    // Get assigned services for all staff members in a single batch query
    const staffIds = allStaff.map((s) => s.id);
    const servicesMap = await getServicesForStaff(db, { staffServices, services }, staffIds);

    return allStaff.map((staffMember) => ({
      ...staffMember,
      services: servicesMap.get(staffMember.id) ?? [],
    }));
  });
}

export async function getStaffMember(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { staff, staffServices, services }) => {
    const [staffMember] = await db
      .select()
      .from(staff)
      .where(eq(staff.id, id))
      .limit(1);

    if (!staffMember) return null;

    const assignedServices = await db
      .select({
        serviceId: staffServices.serviceId,
        serviceName: services.name,
      })
      .from(staffServices)
      .innerJoin(services, eq(staffServices.serviceId, services.id))
      .where(eq(staffServices.staffId, staffMember.id));

    return {
      ...staffMember,
      services: assignedServices,
    };
  });
}


// ---- Online booking: when each person's books are open --------------------------------

type BooksFail = { success: false; error: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const booksModeSchema = z.enum(["open", "windows", "closed"]);

const windowSchema = z.object({
  staffId: z.uuid(),
  from: z.string().regex(DAY_RE),
  to: z.string().regex(DAY_RE),
  mode: z.enum(["requests", "direct"]),
});

async function booksGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  return { slug, ts: await getT("settings", slug) };
}

export async function setBooksMode(
  staffId: string,
  mode: "open" | "windows" | "closed",
): Promise<{ success: true } | BooksFail> {
  await requireStaff();
  const { slug, ts } = await booksGuard();
  const parsed = z.object({ staffId: z.uuid(), mode: booksModeSchema }).safeParse({ staffId, mode });
  if (!parsed.success) return { success: false, error: ts("staffBooks.saveFailed") };
  const rows = await withTenantDb(slug, async (db, { staff }) =>
    db
      .update(staff)
      .set({ booksMode: parsed.data.mode, updatedAt: new Date() })
      .where(and(eq(staff.id, parsed.data.staffId), eq(staff.isActive, 1)))
      .returning({ id: staff.id }),
  );
  await syncBillableStaff(slug);
  if (rows.length === 0) return { success: false, error: ts("staffBooks.saveFailed") };
  revalidatePath("/settings/staff");
  return { success: true };
}

export type BookingWindowView = {
  id: string;
  /** First day, YYYY-MM-DD in the business time zone. */
  from: string;
  /** Last day (inclusive), YYYY-MM-DD in the business time zone. */
  to: string;
  mode: "requests" | "direct";
};

/** Windows that have not ended yet, for one team member's edit sheet. */
export async function listBookingWindows(staffId: string): Promise<BookingWindowView[]> {
  await requireStaff();
  const { slug } = await booksGuard();
  if (!z.uuid().safeParse(staffId).success) return [];
  const { timezone } = await loadSchedulingSettings(slug);
  const rows = await withTenantDb(slug, async (db, { bookingWindows }) =>
    db
      .select()
      .from(bookingWindows)
      .where(and(eq(bookingWindows.staffId, staffId), gt(bookingWindows.closesAt, new Date())))
      .orderBy(asc(bookingWindows.opensAt)),
  );
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  return rows.map((r) => ({
    id: r.id,
    from: day(r.opensAt),
    // closes_at is midnight after the last day, so step back one millisecond.
    to: day(new Date(r.closesAt.getTime() - 1)),
    mode: r.mode === "direct" ? "direct" : "requests",
  }));
}

/** Opens 00:00 on `from` and closes 00:00 the day after `to`, in the business time zone. */
export async function addBookingWindow(input: {
  staffId: string;
  from: string;
  to: string;
  mode: "requests" | "direct";
}): Promise<{ success: true; id: string } | BooksFail> {
  await requireStaff();
  const { slug, ts } = await booksGuard();
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: ts("staffBooks.saveFailed") };
  const { staffId, from, to, mode } = parsed.data;
  if (to < from) return { success: false, error: ts("staffBooks.badRange") };

  const { timezone } = await loadSchedulingSettings(slug);
  const opensAt = wallClockToDate(from, "00:00", timezone);
  const closesAt = wallClockToDate(addDays(to, 1), "00:00", timezone);
  const rows = await withTenantDb(slug, async (db, { staff, bookingWindows }) => {
    const [member] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.isActive, 1)))
      .limit(1);
    if (!member) return [];
    return db
      .insert(bookingWindows)
      .values({ staffId, opensAt, closesAt, mode })
      .returning({ id: bookingWindows.id });
  });
  if (rows.length === 0) return { success: false, error: ts("staffBooks.saveFailed") };
  revalidatePath("/settings/staff");
  return { success: true, id: rows[0].id };
}

export async function removeBookingWindow(id: string): Promise<{ success: true } | BooksFail> {
  await requireStaff();
  const { slug, ts } = await booksGuard();
  if (!z.uuid().safeParse(id).success) return { success: false, error: ts("staffBooks.saveFailed") };
  await withTenantDb(slug, async (db, { bookingWindows }) =>
    db.delete(bookingWindows).where(eq(bookingWindows.id, id)),
  );
  revalidatePath("/settings/staff");
  return { success: true };
}
