export const DEFAULT_PREVIEW_TENANT_SLUG = "test-salon";

export function resolvePreviewTenantSlug(): string {
  return (
    process.env.PREVIEW_TENANT_SLUG?.trim() || DEFAULT_PREVIEW_TENANT_SLUG
  );
}

/** True when this deployment should use PREVIEW_TENANT_SLUG / default pilot tenant. */
export function previewTenantEnvApplies(hostname: string): boolean {
  if (process.env.VERCEL_ENV === "preview") return true;
  return (
    hostname.endsWith(".vercel.app") && process.env.VERCEL_ENV !== "production"
  );
}
