"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { z } from "zod";
import { addMinutes } from "date-fns";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import { findBusyConflicts } from "@/lib/scheduling/service";

const createTimeBlockSchema = z.object({
  staffId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  label: z.string().max(200).optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
});

const deleteTimeBlockSchema = z.object({
  id: z.string().uuid(),
});

export async function createTimeBlock(
  data: z.infer<typeof createTimeBlockSchema>,
) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createTimeBlockSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  const { staffId, startTime, durationMinutes, label, locationId } =
    parsed.data;
  const start = new Date(startTime);
  const end = addMinutes(start, durationMinutes);

  const available =
    (
      await findBusyConflicts({
        slug,
        staffId,
        start,
        end,
        locationId: locationId ?? null,
        kinds: ["appointment", "block"],
      })
    ).length === 0;
  if (!available) {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message:
          "That time conflicts with an appointment or another time block",
      },
    };
  }

  try {
    await withTenantDb(slug, async (db, { timeBlocks }) => {
      await db.insert(timeBlocks).values({
        staffId,
        locationId: locationId ?? null,
        during: { start, end },
        label: label?.trim() || null,
        updatedAt: new Date(),
      });
    });
    revalidatePath("/schedule");
    return { success: true as const };
  } catch (e) {
    console.error("createTimeBlock", e);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Could not create time block (overlap or server error)",
      },
    };
  }
}

export async function deleteTimeBlock(data: z.infer<typeof deleteTimeBlockSchema>) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = deleteTimeBlockSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }


  try {
    const deleted = await withTenantDb(slug, async (db, { timeBlocks }) => {
      return db
        .delete(timeBlocks)
        .where(eq(timeBlocks.id, parsed.data.id))
        .returning({ id: timeBlocks.id });
    });
    if (deleted.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Time block not found",
        },
      };
    }
    revalidatePath("/schedule");
    return { success: true as const };
  } catch (e) {
    console.error("deleteTimeBlock", e);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to delete time block",
      },
    };
  }
}
