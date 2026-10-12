import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { getBusinessSettings } from "@/actions/policies";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { getProject } from "@/actions/projects";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DesignActions, ProjectStatusForm } from "./project-controls";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("projects");
  const { role } = await requireRole("owner", "admin", "provider");
  requirePermission(role, "manage_clients");
  const { id } = await params;

  const detail = await getProject(id);
  if (!detail) notFound();
  const fieldDefinitions = await listCustomFieldDefinitions("project");

  const slug = await getTenantSlug();
  const [t, settings] = await Promise.all([getT("projects", slug), getBusinessSettings()]);
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: settings.timezone });
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: settings.timezone });
  const { project, client, appointments, ledger, design } = detail;
  const apptStatus = (s: string) => (s in APPT_STATUSES ? t(`apptStatuses.${s}`) : s);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div className="space-y-2">
        <Button asChild variant="outline" className="h-11">
          <Link href="/projects">{t("back")}</Link>
        </Button>
        <h1 className="text-2xl font-bold">{project.title}</h1>
        <p>
          {client.name} - {t(`statuses.${project.status}`)}
        </p>
        {(project.placement || project.size) && (
          <p className="text-muted-foreground">{[project.placement, project.size].filter(Boolean).join(" - ")}</p>
        )}
      </div>

      <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-muted-foreground">{t("summary.quoted")}</dt>
          <dd className="text-xl font-semibold">{project.quotedTotalCents === null ? t("noQuote") : formatCurrency(project.quotedTotalCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("summary.paid")}</dt>
          <dd className="text-xl font-semibold">{formatCurrency(ledger.paidCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("summary.left")}</dt>
          <dd className="text-xl font-semibold">{ledger.balanceCents === null ? t("noQuote") : formatCurrency(ledger.balanceCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("summary.credit")}</dt>
          <dd className="text-xl font-semibold">{formatCurrency(ledger.depositCreditCents)}</dd>
        </div>
      </dl>

      {fieldDefinitions.length > 0 ? (
        <CustomFieldsCard
          entity="project"
          ownerId={project.id}
          definitions={fieldDefinitions}
          values={project.attributes}
          canEdit
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("timeline")}</h2>
        {appointments.length === 0 ? (
          <p className="text-muted-foreground">{t("timelineEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">{when.format(a.start)}</p>
                  {a.serviceNames.length > 0 && <p className="text-sm text-muted-foreground">{a.serviceNames.join(", ")}</p>}
                </div>
                <p className="text-sm">
                  {apptStatus(a.status)}
                  {a.paidCents > 0 && <> - {t("paidAmount", { amount: formatCurrency(a.paidCents) })}</>}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Button asChild  variant="default">
          <Link href={`/schedule?client=${project.clientId}&projectId=${project.id}`}>{t("bookNext")}</Link>
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("design")}</h2>
        {design.viewUrl ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={design.viewUrl} alt={t("designAlt", { title: project.title })} className="max-h-96 rounded-[8px] border object-contain" />
            <p className="font-medium">
              {design.approvedAt
                ? t("approvedBy", { name: design.approvedName ?? "", date: day.format(design.approvedAt) })
                : design.sentAt
                  ? t("waiting")
                  : t("notApproved")}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("noDesign")}</p>
        )}
        <DesignActions projectId={project.id} hasDesign={design.viewUrl !== null} clientName={client.name} />
      </section>

      <ProjectStatusForm
        project={{
          id: project.id,
          staffId: project.staffId,
          title: project.title,
          placement: project.placement,
          size: project.size,
          estSessions: project.estSessions,
          quotedTotalCents: project.quotedTotalCents,
          notes: project.notes,
          status: project.status,
        }}
      />
    </div>
  );
}

const APPT_STATUSES = { confirmed: 1, completed: 1, cancelled: 1, no_show: 1 } as const;
