"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { eq, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface ServiceCategory {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
}

/** Turn a human category name into a stable, unique-ish slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** List a salon's active categories (defaults + custom), ordered for display. */
export async function listServiceCategories(): Promise<ServiceCategory[]> {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { serviceCategories }) => {
    const rows = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.isActive, 1))
      .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      sortOrder: r.sortOrder,
      isDefault: r.isDefault === 1,
      isActive: r.isActive === 1,
    }));
  });
}

const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(40, "Name is too long"),
});

/** Create a custom category. Returns the created row (or an error). */
export async function createServiceCategory(data: { name: string }) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  const baseSlug = slugify(parsed.data.name);
  if (!baseSlug) {
    return {
      success: false as const,
      error: { formErrors: ["Enter a valid category name"], fieldErrors: {} },
    };
  }

  try {
    const created = await withTenantDb(slug, async (db, { serviceCategories }) => {
      // Ensure a unique slug (append -2, -3, … on collision).
      const existing = await db
        .select({ slug: serviceCategories.slug })
        .from(serviceCategories);
      const taken = new Set(existing.map((e) => e.slug));
      let finalSlug = baseSlug;
      let n = 2;
      while (taken.has(finalSlug)) finalSlug = `${baseSlug}-${n++}`;

      const maxSort = await db
        .select({ sortOrder: serviceCategories.sortOrder })
        .from(serviceCategories)
        .orderBy(asc(serviceCategories.sortOrder));
      const nextSort =
        (maxSort.length ? maxSort[maxSort.length - 1].sortOrder : 0) + 10;

      const [row] = await db
        .insert(serviceCategories)
        .values({
          slug: finalSlug,
          name: parsed.data.name.trim(),
          sortOrder: nextSort,
          isDefault: 0,
        })
        .returning();
      return row;
    });

    revalidatePath("/settings/services");
    revalidatePath("/services");
    return { success: true as const, category: { id: created.id, slug: created.slug, name: created.name } };
  } catch {
    return {
      success: false as const,
      error: { formErrors: ["Failed to create category"], fieldErrors: {} },
    };
  }
}

const renameCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(40, "Name is too long"),
});

/** Rename a category (slug is preserved so existing services keep their link). */
export async function renameServiceCategory(data: { id: string; name: string }) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = renameCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  try {
    await withTenantDb(slug, async (db, { serviceCategories }) => {
      await db
        .update(serviceCategories)
        .set({ name: parsed.data.name.trim(), updatedAt: new Date() })
        .where(eq(serviceCategories.id, parsed.data.id));
    });
    revalidatePath("/settings/services");
    revalidatePath("/services");
    return { success: true as const };
  } catch {
    return { success: false as const, error: { formErrors: ["Failed to rename"], fieldErrors: {} } };
  }
}

/**
 * Deactivate a custom category. Any services still pointing at it are reassigned
 * to "other" so the booking page never references a missing category. Default
 * categories cannot be deleted.
 */
export async function deleteServiceCategory(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {
    const result = await withTenantDb(slug, async (db, { serviceCategories, services }) => {
      const [cat] = await db
        .select()
        .from(serviceCategories)
        .where(eq(serviceCategories.id, id))
        .limit(1);
      if (!cat) return { ok: false as const, reason: "Category not found" };
      if (cat.isDefault === 1) {
        return { ok: false as const, reason: "Default categories can't be deleted" };
      }
      // Reassign services on this category back to "other".
      await db
        .update(services)
        .set({ category: "other", updatedAt: new Date() })
        .where(eq(services.category, cat.slug));
      await db
        .update(serviceCategories)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(serviceCategories.id, id));
      return { ok: true as const };
    });

    if (!result.ok) {
      return { success: false as const, error: { message: result.reason } };
    }
    revalidatePath("/settings/services");
    revalidatePath("/services");
    return { success: true as const };
  } catch {
    return { success: false as const, error: { message: "Failed to delete category" } };
  }
}

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

/** Persist a new display order for categories. */
export async function reorderServiceCategories(data: { orderedIds: string[] }) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = reorderSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  try {
    await withTenantDb(slug, async (db, { serviceCategories }) => {
      await db.transaction(async (tx) => {
        for (let i = 0; i < parsed.data.orderedIds.length; i++) {
          await tx
            .update(serviceCategories)
            .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
            .where(eq(serviceCategories.id, parsed.data.orderedIds[i]));
        }
      });
    });
    revalidatePath("/settings/services");
    return { success: true as const };
  } catch {
    return { success: false as const, error: { formErrors: ["Failed to reorder"], fieldErrors: {} } };
  }
}
