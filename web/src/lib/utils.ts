import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function withoutTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Resolve the app's public base URL (no trailing slash). */
export function getBaseUrl(): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return withoutTrailingSlash(appUrl);
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicUrl) return withoutTrailingSlash(publicUrl);
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;
  return "http://localhost:3000"; // pragma: allowlist secret
}
