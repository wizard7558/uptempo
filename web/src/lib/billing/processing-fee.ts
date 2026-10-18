import { isSingleMode } from "@/lib/config/mode";

const HOSTED_RATE_BPS = 500;
const MAX_FIXED_CENTS = 100;

export type ProcessingTenant = {
  comped?: number | null;
  processingRateBps?: number | null;
};

const loggedInvalid = new Set<string>();

function logInvalid(name: string, raw: string, max: number, fallback: number) {
  const key = `${name}=${raw}`;
  if (loggedInvalid.has(key)) return;
  loggedInvalid.add(key);
  console.error(
    `${name} must be an integer from 0 to ${max}. Got ${JSON.stringify(raw)}. Using ${fallback}.`,
  );
}

function readBoundedInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const token = raw.trim();
  if (!/^\d+$/.test(token)) {
    logInvalid(name, raw, max, fallback);
    return fallback;
  }
  const n = Number(token);
  if (n > max) {
    logInvalid(name, raw, max, fallback);
    return fallback;
  }
  return n;
}

export function processingFixedCents(): number {
  return readBoundedInt(
    "PLATFORM_PROCESSING_FIXED_CENTS",
    0,
    MAX_FIXED_CENTS,
  );
}

export function processingRateBps(tenant: ProcessingTenant): number {
  if (isSingleMode()) return 0;
  if (tenant.comped === 1) return 0;
  return HOSTED_RATE_BPS;
}

export function processingFeeCents(
  amountCents: number,
  tenant: ProcessingTenant,
): number {
  if (amountCents <= 0) return 0;
  const bps = processingRateBps(tenant);
  if (bps <= 0) return 0;
  const fee = Math.round((amountCents * bps) / 10_000) + processingFixedCents();
  return Math.min(fee, amountCents - 1);
}

export function processingFeePercent(tenant: ProcessingTenant): number {
  return processingRateBps(tenant) / 100;
}

export function processingRateLabel(bps: number): string {
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${text}%`;
}
