/**
 * Provider selection (edge-safe: no imports). Pure functions take an env
 * object; `readProviderEnv()` builds it with literal property reads on the process env so
 * Next can collect them for middleware.
 */
import type { UptempoMode } from "@/lib/config/mode";

export type ProviderEnv = Partial<
  Record<
    | "STORAGE_PROVIDER"
    | "BLOB_READ_WRITE_TOKEN"
    | "EMAIL_PROVIDER"
    | "RESEND_API_KEY"
    | "SMTP_HOST"
    | "SMS_PROVIDER"
    | "TWILIO_ACCOUNT_SID"
    | "DOMAINS_PROVIDER"
    | "VERCEL_TOKEN"
    | "VERCEL_PROJECT_ID"
    | "DOMAIN_MAP_PROVIDER"
    | "GLOBAL_CONFIG"
    | "EDGE_CONFIG"
    | "UPTEMPO_DOMAIN_MAP",
    string | undefined
  >
>;

export function readProviderEnv(): ProviderEnv {
  return {
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SMS_PROVIDER: process.env.SMS_PROVIDER,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    DOMAINS_PROVIDER: process.env.DOMAINS_PROVIDER,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    DOMAIN_MAP_PROVIDER: process.env.DOMAIN_MAP_PROVIDER,
    GLOBAL_CONFIG: process.env.GLOBAL_CONFIG,
    EDGE_CONFIG: process.env.EDGE_CONFIG,
    UPTEMPO_DOMAIN_MAP: process.env.UPTEMPO_DOMAIN_MAP,
  };
}

const PLACEHOLDER_RESEND_KEYS = new Set(["re_placeholder", "test", "your-resend-api-key"]);

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function explicit<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = clean(raw)?.toLowerCase();
  if (!v) return undefined;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`${name} must be one of ${allowed.join("|")}`);
}

export const STORAGE_PROVIDER_IDS = ["vercel-blob", "local", "s3"] as const;
export const EMAIL_PROVIDER_IDS = ["resend", "smtp", "console"] as const;
export const SMS_PROVIDER_IDS = ["twilio", "loopmessage", "none"] as const;
export const DOMAINS_PROVIDER_IDS = ["vercel", "none"] as const;
export const DOMAIN_MAP_PROVIDER_IDS = ["global-config", "static", "none"] as const;

export function resolveStorageProviderId(e: ProviderEnv): (typeof STORAGE_PROVIDER_IDS)[number] {
  return (
    explicit("STORAGE_PROVIDER", e.STORAGE_PROVIDER, STORAGE_PROVIDER_IDS) ??
    (clean(e.BLOB_READ_WRITE_TOKEN) ? "vercel-blob" : "local")
  );
}

export function resolveEmailProviderId(e: ProviderEnv): (typeof EMAIL_PROVIDER_IDS)[number] {
  const chosen = explicit("EMAIL_PROVIDER", e.EMAIL_PROVIDER, EMAIL_PROVIDER_IDS);
  if (chosen) return chosen;
  const key = clean(e.RESEND_API_KEY);
  if (key && !PLACEHOLDER_RESEND_KEYS.has(key)) return "resend";
  if (clean(e.SMTP_HOST)) return "smtp";
  return "console";
}

export function resolveSmsProviderId(e: ProviderEnv): (typeof SMS_PROVIDER_IDS)[number] {
  return (
    explicit("SMS_PROVIDER", e.SMS_PROVIDER, SMS_PROVIDER_IDS) ??
    (clean(e.TWILIO_ACCOUNT_SID) ? "twilio" : "none")
  );
}

export function resolveDomainsProviderId(
  e: ProviderEnv,
  mode: UptempoMode,
): (typeof DOMAINS_PROVIDER_IDS)[number] {
  if (mode === "single") return "none";
  return (
    explicit("DOMAINS_PROVIDER", e.DOMAINS_PROVIDER, DOMAINS_PROVIDER_IDS) ??
    (clean(e.VERCEL_TOKEN) && clean(e.VERCEL_PROJECT_ID) ? "vercel" : "none")
  );
}

export function resolveDomainMapProviderId(
  e: ProviderEnv,
  mode: UptempoMode,
): (typeof DOMAIN_MAP_PROVIDER_IDS)[number] {
  if (mode === "single") return "none";
  const chosen = explicit("DOMAIN_MAP_PROVIDER", e.DOMAIN_MAP_PROVIDER, DOMAIN_MAP_PROVIDER_IDS);
  if (chosen) return chosen;
  if (clean(e.GLOBAL_CONFIG) || clean(e.EDGE_CONFIG)) return "global-config";
  if (clean(e.UPTEMPO_DOMAIN_MAP)) return "static";
  return "none";
}
