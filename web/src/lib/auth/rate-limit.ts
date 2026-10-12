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

  if (scope === "identifier") {
    return trimmed.toLowerCase();
  }

  return trimmed;
}

export async function consumeRateLimit(
  params: RateLimitParams,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowResetThreshold = new Date(now.getTime() - params.windowMs);
  const nowIso = now.toISOString();
  const windowResetThresholdIso = windowResetThreshold.toISOString();
  const normalizedKey = normalizeRateLimitKey(params.scope, params.key);

  const [row] = await publicDb
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

  if (row.attemptCount <= params.limit) {
    return { allowed: true };
  }

  const retryAfterMs = Math.max(
    0,
    params.windowMs - (now.getTime() - row.windowStartedAt.getTime()),
  );

  return { allowed: false, retryAfterMs };
}
