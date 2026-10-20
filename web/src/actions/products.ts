"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import {
  uploadImageToBlobStorage,
  deleteBlobImageIfOurs,
} from "@/lib/storage/image-blob-upload";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from "@/lib/validators/product";

/**
 * Upload a product photo to Vercel Blob and return its public URL. Owner-only.
 * FormData: `file` (image) and optional `oldUrl` (replaced blob to clean up).
 * The client downscales phone photos before calling this; 8MB is a hard cap
 * for originals that couldn't be downscaled (e.g. HEIC on non-Safari).
 */
export async function uploadProductPhoto(formData: FormData): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const session = await requireRole("owner");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = session.tenantSlug;
  try {

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "No file provided" };
    }
    const oldRaw = formData.get("oldUrl");
    const oldUrl =
      typeof oldRaw === "string" && oldRaw.trim().length > 0
        ? oldRaw.trim()
        : null;

    const result = await uploadImageToBlobStorage({
      pathPrefix: "products",
      key: slug,
      file,
      oldUrl,
      maxBytes: 8 * 1024 * 1024,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, url: result.url };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[uploadProductPhoto]", err);
    return { ok: false, error: "Could not upload the photo" };
  }
}

export interface ProductView {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  size: string | null;
  priceCents: number;
  costCents: number | null;
  photoUrl: string | null;
  tags: string[];
  isActive: boolean;
  sortOrder: number;
}

function toView(row: {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  size: string | null;
  priceCents: number;
  costCents: number | null;
  photoUrl: string | null;
  tags: string[] | null;
  isActive: number;
  sortOrder: number;
}): ProductView {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    size: row.size,
    priceCents: row.priceCents,
    costCents: row.costCents,
    photoUrl: row.photoUrl,
    tags: row.tags ?? [],
    isActive: row.isActive === 1,
    sortOrder: row.sortOrder,
  };
}

/** All products for the current business, sorted for the admin list. */
export async function listProducts(): Promise<ProductView[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { products }) => {
    const rows = await db
      .select()
      .from(products)
      .orderBy(asc(products.sortOrder), asc(products.name));
    return rows.map(toView);
  });
}

export async function createProduct(data: CreateProductInput) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createProductSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  const p = parsed.data;
  try {
    const [row] = await withTenantDb(slug, async (db, { products }) => {
      return db
        .insert(products)
        .values({
          name: p.name,
          brand: p.brand ?? null,
          description: p.description ?? null,
          size: p.size ?? null,
          priceCents: p.priceCents,
          costCents: p.costCents ?? null,
          photoUrl: p.photoUrl ?? null,
          tags: p.tags ?? [],
          isActive: p.isActive === false ? 0 : 1,
          sortOrder: p.sortOrder ?? 0,
        })
        .returning({ id: products.id });
    });
    revalidatePath("/settings/products");
    return { success: true as const, id: row.id };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error("createProduct", e);
    return {
      success: false as const,
      error: {
        formErrors: ["Could not create product"],
        fieldErrors: {},
      },
    };
  }
}

export async function updateProduct(data: UpdateProductInput) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateProductSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  const { id, ...fields } = parsed.data;

  // Only set the fields that were provided.
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.brand !== undefined) updates.brand = fields.brand ?? null;
  if (fields.description !== undefined)
    updates.description = fields.description ?? null;
  if (fields.size !== undefined) updates.size = fields.size ?? null;
  if (fields.priceCents !== undefined) updates.priceCents = fields.priceCents;
  if (fields.costCents !== undefined) updates.costCents = fields.costCents ?? null;
  if (fields.photoUrl !== undefined) updates.photoUrl = fields.photoUrl ?? null;
  if (fields.tags !== undefined) updates.tags = fields.tags;
  if (fields.isActive !== undefined) updates.isActive = fields.isActive ? 1 : 0;
  if (fields.sortOrder !== undefined) updates.sortOrder = fields.sortOrder;

  try {
    const result = await withTenantDb(slug, async (db, { products }) => {
      return db
        .update(products)
        .set(updates)
        .where(eq(products.id, id))
        .returning({ id: products.id });
    });
    if (result.length === 0) {
      return {
        success: false as const,
        error: { formErrors: ["Product not found"], fieldErrors: {} },
      };
    }
    revalidatePath("/settings/products");
    return { success: true as const };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error("updateProduct", e);
    return {
      success: false as const,
      error: { formErrors: ["Could not update product"], fieldErrors: {} },
    };
  }
}

export interface StorefrontSettings {
  /** Sales tax in basis points (725 = 7.25%); 0 = no tax collected. */
  retailTaxBps: number;
  /** Flat shipping rate in cents; null = pickup only. */
  retailShipFlatCents: number | null;
}

/** Retail tax + shipping settings for the current business's storefront. */
export async function getStorefrontSettings(): Promise<StorefrontSettings> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [row] = await db
      .select({
        retailTaxBps: businessSettings.retailTaxBps,
        retailShipFlatCents: businessSettings.retailShipFlatCents,
      })
      .from(businessSettings)
      .limit(1);
    return {
      retailTaxBps: row?.retailTaxBps ?? 0,
      retailShipFlatCents: row?.retailShipFlatCents ?? null,
    };
  });
}

/** Update retail tax + shipping settings. Pass shipFlatCents null for pickup-only. */
export async function updateStorefrontSettings(
  data: StorefrontSettings,
): Promise<{ success: boolean; message?: string }> {
  const { tenantSlug: slug } = await requireStaff();
  const taxOk =
    Number.isInteger(data.retailTaxBps) &&
    data.retailTaxBps >= 0 &&
    data.retailTaxBps <= 2_000; // 20% sanity cap
  const shipOk =
    data.retailShipFlatCents === null ||
    (Number.isInteger(data.retailShipFlatCents) &&
      data.retailShipFlatCents >= 0 &&
      data.retailShipFlatCents <= 10_000); // $100 cap
  if (!taxOk || !shipOk) {
    return { success: false, message: "Enter valid tax and shipping values" };
  }
  try {
    await withTenantDb(slug, async (db, { businessSettings }) => {
      await db.update(businessSettings).set({
        retailTaxBps: data.retailTaxBps,
        retailShipFlatCents: data.retailShipFlatCents,
        updatedAt: new Date(),
      });
    });
    revalidatePath("/settings/products");
    return { success: true };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error("updateStorefrontSettings", e);
    return { success: false, message: "Could not save settings" };
  }
}

export async function deleteProduct(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  if (typeof id !== "string" || id.length === 0) {
    return { success: false as const, message: "Missing product id" };
  }
  try {
    const result = await withTenantDb(slug, async (db, { products }) => {
      return db
        .delete(products)
        .where(eq(products.id, id))
        .returning({ id: products.id, photoUrl: products.photoUrl });
    });
    if (result.length === 0) {
      return { success: false as const, message: "Product not found" };
    }
    // Best-effort: clean up the product's photo if it lives in our Blob store.
    await deleteBlobImageIfOurs(result[0].photoUrl);
    revalidatePath("/settings/products");
    return { success: true as const };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error("deleteProduct", e);
    return { success: false as const, message: "Could not delete product" };
  }
}
