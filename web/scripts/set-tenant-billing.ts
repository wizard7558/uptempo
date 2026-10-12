/**
 * Enable or disable paid platform billing for a tenant.
 *
 *   npx tsx scripts/set-tenant-billing.ts <slug> on|off
 *   npx tsx scripts/set-tenant-billing.ts --list        # show all tenants' status
 *
 * Operates on whatever DATABASE_URL is loaded (defaults to .env.local). To
 * target production, pin DATABASE_URL from Vercel first.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";

async function main() {
  const { publicDb } = await import("../src/lib/db");
  const { tenants } = await import("../src/lib/db/schema");

  const [arg1, arg2] = process.argv.slice(2);

  if (arg1 === "--list" || !arg1) {
    const rows = await publicDb
      .select({
        slug: tenants.slug,
        name: tenants.name,
        plan: tenants.plan,
        billingEnabled: tenants.billingEnabled,
        hasCard: tenants.platformPaymentMethodId,
      })
      .from(tenants)
      .orderBy(tenants.slug);
    console.log("slug\tplan\tbilling\tcard");
    for (const r of rows) {
      console.log(
        `${r.slug}\t${r.plan}\t${r.billingEnabled === 1 ? "ON" : "off"}\t${r.hasCard ? "yes" : "no"}`,
      );
    }
    process.exit(0);
  }

  const slug = arg1;
  const on = arg2 === "on" || arg2 === "1" || arg2 === "true";
  const off = arg2 === "off" || arg2 === "0" || arg2 === "false";
  if (!on && !off) {
    console.error("Usage: set-tenant-billing.ts <slug> on|off");
    process.exit(1);
  }

  const updated = await publicDb
    .update(tenants)
    .set({ billingEnabled: on ? 1 : 0, updatedAt: new Date() })
    .where(eq(tenants.slug, slug))
    .returning({ slug: tenants.slug, billingEnabled: tenants.billingEnabled });

  if (updated.length === 0) {
    console.error(`No tenant with slug "${slug}"`);
    process.exit(1);
  }
  console.log(
    `Set ${updated[0].slug} billing_enabled = ${updated[0].billingEnabled === 1 ? "ON" : "off"}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
