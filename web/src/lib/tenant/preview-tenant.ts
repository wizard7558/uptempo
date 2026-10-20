export function resolvePreviewTenantSlug(): string | null {
  return process.env.PREVIEW_TENANT_SLUG?.trim() || null;
}

/** True when this deployment should use an explicitly configured preview tenant. */
export function previewTenantEnvApplies(hostname: string): boolean {
  if (process.env.VERCEL_ENV === "preview") return true;
  return (
    hostname.endsWith(".vercel.app") && process.env.VERCEL_ENV !== "production"
  );
}
