"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { getBusinessSettings } from "@/actions/policies";
import { bookingRulesSchema, type BookingRules } from "@/lib/validators/booking-rules";

export async function getBookingRules(): Promise<BookingRules> {
  await requireStaff();
  const s = await getBusinessSettings();
  return {
    sameDayBooking: s.sameDayBooking === 1 ? 1 : 0,
    minNoticeMinutes: s.minNoticeMinutes,
    maxAdvanceDays: s.maxAdvanceDays,
    slotIntervalMinutes: s.slotIntervalMinutes as BookingRules["slotIntervalMinutes"],
  };
}

export async function updateBookingRules(
  data: BookingRules,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const parsed = bookingRulesSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid booking rules" };
  }
  try {
  const slug = session.tenantSlug;
    const existing = await getBusinessSettings();
    await withTenantDb(slug, async (db, { businessSettings }) =>
      db
        .update(businessSettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(businessSettings.id, existing.id)),
    );
    revalidatePath("/settings/booking");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return { success: false, error: "Failed to update booking rules" };
  }
}
