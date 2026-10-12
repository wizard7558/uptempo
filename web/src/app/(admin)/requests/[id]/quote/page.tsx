import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { hasModule, requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { withTenantDb } from "@/lib/db/tenant";
import { getRequestDetail } from "@/actions/requests";
import { canTransitionRequest } from "@/lib/requests/status";
import { QuoteBuilder, type BuilderInitial } from "./quote-builder";

export default async function QuoteBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("requests");
  const { role } = await requireRole("owner", "admin", "provider");
  requirePermission(role, "manage_clients");
  const { id } = await params;
  const slug = await getTenantSlug();

  const detail = await getRequestDetail(id);
  if (!detail) notFound();
  if (!canTransitionRequest(detail.request.status, "quoted")) redirect(`/requests/${id}`);

  const { services, staff } = await withTenantDb(slug, async (db, t) => ({
    services: await db
      .select({
        id: t.services.id,
        name: t.services.name,
        priceCents: t.services.priceCents,
        defaultDurationMinutes: t.services.defaultDurationMinutes,
      })
      .from(t.services)
      .where(eq(t.services.isActive, 1))
      .orderBy(asc(t.services.name)),
    staff: await db
      .select({ id: t.staff.id, displayName: t.staff.displayName })
      .from(t.staff)
      .where(eq(t.staff.isActive, 1))
      .orderBy(asc(t.staff.displayName)),
  }));

  const projectsOn = await hasModule(slug, "projects");
  const draft = detail.quotes.find((q) => q.status === "draft");
  const initial: BuilderInitial | undefined = draft
    ? {
        quoteId: draft.id,
        staffId: draft.staffId,
        lines: draft.lines,
        depositCents: draft.depositCents,
        message: draft.message ?? "",
        validDays: 14,
        projectSessions: draft.projectSessions,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <QuoteBuilder
        requestId={id}
        clientName={detail.client.name}
        services={services}
        staff={staff}
        projectsOn={projectsOn}
        initial={initial ?? (detail.request.staffId ? { staffId: detail.request.staffId, lines: [], depositCents: 0, message: "", validDays: 14 } : undefined)}
      />
    </div>
  );
}
