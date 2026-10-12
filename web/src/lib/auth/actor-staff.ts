import { and, eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

/** The staff row that belongs to this signed-in user in this tenant, or null (owners may have none). */
export async function getActorStaffId(slug: string, userId: string): Promise<string | null> {
  return withTenantDb(slug, async (db, { staff }) => {
    const [row] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.userId, userId), eq(staff.isActive, 1)))
      .limit(1);
    return row?.id ?? null;
  });
}
