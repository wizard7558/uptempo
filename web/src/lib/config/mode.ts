/**
 * Deployment mode (edge-safe: no imports). The access must stay a literal
 * `process.env.UPTEMPO_MODE` so Next collects it for middleware and resolves it
 * at runtime under `next start`.
 */
export type UptempoMode = "multi" | "single";

export function getUptempoMode(): UptempoMode {
  const v = process.env.UPTEMPO_MODE?.trim().toLowerCase();
  if (!v || v === "multi") return "multi";
  if (v === "single") return "single";
  throw new Error(
    `UPTEMPO_MODE must be "multi" or "single" (got "${process.env.UPTEMPO_MODE}")`,
  );
}

export const isSingleMode = () => getUptempoMode() === "single";
