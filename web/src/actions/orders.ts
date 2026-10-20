"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";

export interface OrderView {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  items: Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitCents: number;
  }>;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  fulfillment: "pickup" | "ship";
  shippingAddress: unknown;
  status: string;
  createdAt: string;
}

/** Recent storefront orders for the current business, newest first. */
export async function listOrders(limit = 50): Promise<OrderView[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, t) => {
    const rows = await db
      .select()
      .from(t.orders)
      .orderBy(desc(t.orders.createdAt))
      .limit(Math.min(200, Math.max(1, limit)));
    return rows.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      items: r.items ?? [],
      subtotalCents: r.subtotalCents,
      taxCents: r.taxCents,
      shippingCents: r.shippingCents,
      totalCents: r.totalCents,
      fulfillment: r.fulfillment === "ship" ? "ship" : "pickup",
      shippingAddress: r.shippingAddress,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/** Mark a paid order fulfilled (picked up / shipped). */
export async function markOrderFulfilled(
  id: string,
): Promise<{ success: boolean; message?: string }> {
  const { tenantSlug: slug } = await requireStaff();
  if (typeof id !== "string" || id.length === 0) {
    return { success: false, message: "Missing order id" };
  }
  try {
    const result = await withTenantDb(slug, async (db, t) => {
      return db
        .update(t.orders)
        .set({ status: "fulfilled", updatedAt: new Date() })
        .where(eq(t.orders.id, id))
        .returning({ id: t.orders.id });
    });
    if (result.length === 0) return { success: false, message: "Order not found" };
    revalidatePath("/settings/products");
    return { success: true };
  } catch (e) {
    console.error("markOrderFulfilled", e);
    return { success: false, message: "Could not update order" };
  }
}
