import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { isSingleMode } from "@/lib/config/mode";
import { closeBillingDatabase } from "@/lib/billing/switch";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { slugSchema } from "@/lib/tenant/slug-validation";

export async function setCompedFromArguments(argv: string[]): Promise<void> {
  if (isSingleMode()) {
    throw new Error("Comped billing controls are only available in hosted mode.");
  }
  if (argv.length !== 2) {
    throw new Error("Usage: tsx scripts/billing/set-comped.ts <tenant-slug> <on|off>");
  }
  const [slug, requestedState] = argv;
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) throw new Error("Tenant slug is not valid for hosted billing.");
  if (requestedState !== "on" && requestedState !== "off") {
    throw new Error("Comped state must be exactly on or off.");
  }

  const [before] = await publicDb
    .select({ name: tenants.name, comped: tenants.comped })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!before) throw new Error(`No hosted business found for slug ${slug}.`);

  const comped = requestedState === "on" ? 1 : 0;
  await publicDb
    .update(tenants)
    .set({ comped, updatedAt: new Date() })
    .where(eq(tenants.slug, slug));

  console.log(
    JSON.stringify({
      slug,
      name: before.name,
      previous: before.comped === 1 ? "on" : "off",
      current: comped === 1 ? "on" : "off",
      externalBillingCalls: 0,
    }),
  );
}

async function main(): Promise<void> {
  try {
    await setCompedFromArguments(process.argv.slice(2));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`[set comped] ${detail}`);
    process.exitCode = 1;
  } finally {
    try {
      await closeBillingDatabase();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      console.error(`[set comped] database close failed: ${detail}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
