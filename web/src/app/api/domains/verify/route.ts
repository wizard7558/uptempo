import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { getDomainsProvider } from "@/lib/providers/domains";
import { publicDb } from "@/lib/db";
import { domainMappings } from "@/lib/db/schema/domain-mappings";
import { eq } from "drizzle-orm";

/**
 * GET /api/domains/verify?domain=book.yourbusiness.com
 * Lightweight polling endpoint for domain verification status.
 * Auth-protected: requires valid session.
 */
export async function GET(request: Request) {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");

  if (!domain) {
    return NextResponse.json({ error: "Missing domain parameter" }, { status: 400 });
  }

  const domains = getDomainsProvider();
  if (!domains.enabled) {
    return NextResponse.json(
      { error: "Custom domains aren't available on this install." },
      { status: 400 },
    );
  }

  try {
    const domainInfo = await domains.get(domain);
    const verification = await domains.verify(domain);

    const verified = verification.value?.verified ?? false;
    const sslStatus = verified ? "active" : "pending";

    // Extract DNS configuration from Vercel response
    const configuration: Array<{ type: string; name: string; value: string }> = [];

    const domainValue = domainInfo.value;
    if (domainValue && typeof domainValue === "object") {
      const verificationArr = (domainValue as Record<string, unknown>).verification;
      if (Array.isArray(verificationArr)) {
        for (const rec of verificationArr) {
          if (rec && typeof rec === "object" && "type" in rec && "domain" in rec && "value" in rec) {
            configuration.push({
              type: String(rec.type),
              name: String(rec.domain),
              value: String(rec.value),
            });
          }
        }
      }
    }

    // Update database status if verified
    if (verified) {
      await publicDb
        .update(domainMappings)
        .set({
          verificationStatus: "verified",
          sslStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(domainMappings.domain, domain));
    }

    return NextResponse.json({ verified, sslStatus, configuration });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
