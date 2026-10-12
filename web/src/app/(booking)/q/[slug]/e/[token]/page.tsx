import { notFound } from "next/navigation";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { isPublicTokenShape } from "@/lib/security/public-token";
import { StatusClient } from "./status-client";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export default async function QueueStatusPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  if (!SLUG_RE.test(slug) || !isPublicTokenShape(token)) notFound();
  if (!(await isTenantProvisioned(slug)) || !(await hasModule(slug, "walk_in_queue"))) notFound();
  return <StatusClient slug={slug} token={token} />;
}
