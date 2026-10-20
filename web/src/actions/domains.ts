"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { getT } from "@/lib/terms/server";
import { publicDb } from "@/lib/db";
import { domainMappings } from "@/lib/db/schema/domain-mappings";
import { customDomainSchema } from "@/lib/validators/domain";
import { registerDomainWithStripe } from "@/lib/domains/stripe-registration";
import { getDomainsProvider } from "@/lib/providers/domains";
import { getDomainMapWriter } from "@/lib/providers/domain-map/writer";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Get domain settings for the current tenant.
 * Returns the default booking URL and all custom domain records.
 */
export async function getDomainSettings() {
  const { tenantSlug: slug } = await requireStaff();
  const rootDomain = (process.env.ROOT_DOMAIN || "bookuptempo.com").trim();
  const bookingUrl = `${rootDomain}/book/${slug}`;

  const customDomains = await publicDb
    .select()
    .from(domainMappings)
    .where(eq(domainMappings.tenantSlug, slug));

  return { bookingUrl, customDomains };
}

/**
 * Add a custom domain for the current tenant.
 * Orchestrates Vercel, Stripe, DB, and Edge Config in sequence with rollback on partial failure.
 */
const DOMAINS_UNAVAILABLE = "Custom domains aren't available on this install.";

export async function addCustomDomain(domain: string): Promise<{ success: true } | { success: false; error: string }> {
  const domains = getDomainsProvider();
  if (!domains.enabled) {
    return { success: false, error: DOMAINS_UNAVAILABLE };
  }
  const { tenantSlug: slug } = await requireStaff();

  // Validate domain format
  let validatedDomain: string;
  try {
    validatedDomain = customDomainSchema.parse(domain);
  } catch {
    return { success: false, error: "Invalid domain format. Enter a valid hostname (e.g., book.example.com)" };
  }

  // Check domain not already claimed
  const existing = await publicDb
    .select()
    .from(domainMappings)
    .where(eq(domainMappings.domain, validatedDomain))
    .limit(1);

  if (existing.length > 0) {
    return { success: false, error: "Domain already in use" };
  }

  // Add domain to Vercel project
  try {
    await domains.add(validatedDomain);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add domain to Vercel";
    return { success: false, error: `Vercel error: ${message}` };
  }

  // Register domain with Stripe for Apple Pay / Google Pay
  try {
    await registerDomainWithStripe(validatedDomain);
  } catch (err) {
    // Rollback Vercel domain on Stripe failure
    try {
      await domains.remove(validatedDomain);
    } catch {
      // Best effort rollback
    }
    const message = err instanceof Error ? err.message : "Failed to register domain with Stripe";
    return { success: false, error: `Stripe error: ${message}` };
  }

  // Insert into database (source of truth)
  await publicDb.insert(domainMappings).values({
    tenantSlug: slug,
    domain: validatedDomain,
    type: "custom",
    verificationStatus: "pending",
    sslStatus: "pending",
    stripeRegistered: "active",
  });

  // Sync the domain map (fire-and-forget). static and none writers are no-ops.
  getDomainMapWriter().upsert(validatedDomain, slug).catch(() => {
    // Map write failure is non-fatal
  });

  revalidatePath("/settings/domain");
  trackEvent("domain.added", { domain: validatedDomain }, { tenantSlug: slug });
  return { success: true };
}

/**
 * Remove a custom domain for the current tenant.
 * Cleans up Vercel, Edge Config, and DB records.
 */
export async function removeCustomDomain(domain: string): Promise<{ success: true } | { success: false; error: string }> {
  const domains = getDomainsProvider();
  if (!domains.enabled) {
    return { success: false, error: DOMAINS_UNAVAILABLE };
  }
  const { tenantSlug: slug } = await requireStaff();

  // Verify domain belongs to this tenant
  const [record] = await publicDb
    .select()
    .from(domainMappings)
    .where(and(eq(domainMappings.domain, domain), eq(domainMappings.tenantSlug, slug)))
    .limit(1);

  if (!record) {
    return { success: false, error: (await getT("errors", slug))("domains.notFound") };
  }

  // Remove from Vercel (continue even if fails -- domain may already be removed)
  try {
    await domains.remove(domain);
  } catch {
    // Best effort
  }

  try {
    await getDomainMapWriter().remove(domain);
  } catch {
    // Best effort
  }

  // Delete from database
  await publicDb
    .delete(domainMappings)
    .where(and(eq(domainMappings.domain, domain), eq(domainMappings.tenantSlug, slug)));

  revalidatePath("/settings/domain");
  trackEvent("domain.removed", { domain }, { tenantSlug: slug });
  return { success: true };
}

/**
 * Verify DNS configuration for a custom domain.
 * Returns verification status, SSL status, and required DNS records.
 */
export async function verifyCustomDomain(domain: string): Promise<
  { verified: boolean; sslStatus: string; dnsRecords: Array<{ type: string; name: string; value: string }> }
  | { error: string }
> {
  const domains = getDomainsProvider();
  if (!domains.enabled) {
    return { error: DOMAINS_UNAVAILABLE };
  }
  const { tenantSlug: slug } = await requireStaff();

  // Verify domain belongs to this tenant
  const [record] = await publicDb
    .select()
    .from(domainMappings)
    .where(and(eq(domainMappings.domain, domain), eq(domainMappings.tenantSlug, slug)))
    .limit(1);

  if (!record) {
    return { error: (await getT("errors", slug))("domains.notFound") };
  }

  try {
    // Get current domain config from Vercel
    const domainInfo = await domains.get(domain);

    // Trigger verification check
    const verification = await domains.verify(domain);

    // Extract verification status
    const verified = verification.value?.verified ?? false;

    // Extract DNS records from domain info
    const dnsRecords: Array<{ type: string; name: string; value: string }> = [];

    // Vercel domain info contains verification records and misconfigured DNS info
    const domainValue = domainInfo.value;
    if (domainValue && typeof domainValue === "object") {
      // Check for verification challenge records
      const verificationArr = (domainValue as Record<string, unknown>).verification;
      if (Array.isArray(verificationArr)) {
        for (const rec of verificationArr) {
          if (rec && typeof rec === "object" && "type" in rec && "domain" in rec && "value" in rec) {
            dnsRecords.push({
              type: String(rec.type),
              name: String(rec.domain),
              value: String(rec.value),
            });
          }
        }
      }
    }

    // If no specific verification records, provide standard DNS instructions
    if (dnsRecords.length === 0) {
      // Determine CNAME vs A record based on whether domain is apex or subdomain
      const parts = domain.split(".");
      if (parts.length > 2) {
        // Subdomain -- use CNAME
        dnsRecords.push({
          type: "CNAME",
          name: domain,
          value: "cname.vercel-dns.com",
        });
      } else {
        // Apex domain -- use A record
        dnsRecords.push({
          type: "A",
          name: domain,
          value: "76.76.21.21",
        });
      }
    }

    // Determine SSL status
    const sslStatus = verified ? "active" : "pending";

    // Update database with new status
    await publicDb
      .update(domainMappings)
      .set({
        verificationStatus: verified ? "verified" : "pending",
        sslStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(domainMappings.domain, domain), eq(domainMappings.tenantSlug, slug)));

    // If newly verified, ensure Edge Config is synced
    if (verified) {
      getDomainMapWriter().upsert(domain, slug).catch(() => {
        // Non-fatal
      });
    }

    revalidatePath("/settings/domain");
    return { verified, sslStatus, dnsRecords };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to verify domain";
    return { error: `Verification error: ${message}` };
  }
}
