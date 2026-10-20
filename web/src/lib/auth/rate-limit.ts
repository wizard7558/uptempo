import { sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { otpRateLimits } from "@/lib/db/schema";

export type RateLimitScope = "identifier" | "ip";

interface RateLimitParams {
  tenantSlug: string;
  scope: RateLimitScope;
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

function normalizeRateLimitKey(scope: RateLimitScope, key: string): string {
  const trimmed = key.trim();
  return scope === "identifier" ? trimmed.toLowerCase() : trimmed;
}

export async function consumeRateLimit(
  params: RateLimitParams,
): Promise<RateLimitResult> {
  const normalizedKey = normalizeRateLimitKey(params.scope, params.key);

  const result = await publicDb.transaction(async (tx) => {
    // Rollback takes this tenant lock before deleting rate rows and the tenant.
    // A waiting request therefore checks the registry after rollback commits.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`app-review-otp-rate:${params.tenantSlug}`}, 0))`,
    );
    const registryRows = Array.from(
      (await tx.execute(
        sql`SELECT id FROM public.tenants WHERE slug = ${params.tenantSlug} FOR KEY SHARE`,
      )) as Iterable<unknown>,
    );
    if (registryRows.length !== 1) {
      throw new Error("Cannot record an OTP rate limit for an unknown tenant");
    }

    // Start the window after any wait for a concurrent rollback or request.
    const now = new Date();
    const windowResetThreshold = new Date(now.getTime() - params.windowMs);
    const nowIso = now.toISOString();
    const windowResetThresholdIso = windowResetThreshold.toISOString();
    const [row] = await tx
      .insert(otpRateLimits)
      .values({
        tenantSlug: params.tenantSlug,
        scope: params.scope,
        normalizedKey,
        attemptCount: 1,
        windowStartedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          otpRateLimits.tenantSlug,
          otpRateLimits.scope,
          otpRateLimits.normalizedKey,
        ],
        set: {
          attemptCount: sql`
            CASE
              WHEN ${otpRateLimits.windowStartedAt} <= ${windowResetThresholdIso} THEN 1
              ELSE LEAST(${otpRateLimits.attemptCount} + 1, ${params.limit + 1})
            END
          `,
          windowStartedAt: sql`
            CASE
              WHEN ${otpRateLimits.windowStartedAt} <= ${windowResetThresholdIso} THEN ${nowIso}
              ELSE ${otpRateLimits.windowStartedAt}
            END
          `,
          updatedAt: now,
        },
      })
      .returning({
        attemptCount: otpRateLimits.attemptCount,
        windowStartedAt: otpRateLimits.windowStartedAt,
      });
    return { row, now };
  });

  const { row, now } = result;
  if (!row) throw new Error("OTP rate-limit update returned no row");
  if (row.attemptCount <= params.limit) return { allowed: true };

  const retryAfterMs = Math.max(
    0,
    params.windowMs - (now.getTime() - row.windowStartedAt.getTime()),
  );
  return { allowed: false, retryAfterMs };
}
