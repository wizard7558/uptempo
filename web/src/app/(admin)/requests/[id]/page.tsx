import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { getBusinessSettings } from "@/actions/policies";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { getRequestDetail, markRequestReviewing } from "@/actions/requests";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
import { canTransitionRequest, DECLINABLE } from "@/lib/requests/status";
import { formatCurrency } from "@/lib/format";
import { dollarsToCents, KNOWN_REQUEST_FIELDS, type RequestFieldDef } from "@/lib/requests/fields";
import { Button } from "@/components/ui/button";
import { DeclineRequestButton, QuoteLinkActions } from "./request-actions";

type T = Awaited<ReturnType<typeof getT>>;

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function answerText(def: RequestFieldDef, value: unknown, t: T): string {
  if (value === undefined || value === null || value === "") return "";
  if (def.kind === "select" && typeof value === "string") return t(`fields.${def.key}.options.${value}`);
  if (def.kind === "money") {
    const cents = typeof value === "number" ? value : dollarsToCents(String(value));
    return cents === null ? "" : formatCurrency(cents);
  }
  if (def.kind === "address" && typeof value === "object") {
    const a = value as Record<string, string>;
    return [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(", ");
  }
  return String(value);
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("requests");
  const { role } = await requireRole("owner", "admin", "provider");
  requirePermission(role, "manage_clients");
  const { id } = await params;

  await markRequestReviewing(id);
  const detail = await getRequestDetail(id);
  if (!detail) notFound();

  const slug = await getTenantSlug();
  const [t, settings] = await Promise.all([getT("requests", slug), getBusinessSettings()]);
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: settings.timezone });
  const { request, client, fields, quotes, photos, attributes } = detail;
  const fieldDefinitions = await listCustomFieldDefinitions("request");

  const answerFields = fields.filter((f) => f.kind !== "photos" && f.kind !== "days");
  const win = request.preferredWindows[0];
  const canQuote = canTransitionRequest(request.status, "quoted");
  const canDecline = DECLINABLE.includes(request.status);

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div className="space-y-2">
        <Button asChild variant="outline" className="h-11">
          <Link href="/requests">{t("detail.back")}</Link>
        </Button>
        <h1 className="text-2xl font-bold">{client.name}</h1>
        <p>{t(`statuses.${request.status}`)}</p>
        {request.status === "declined" && request.declineReason && <p className="text-muted-foreground">{request.declineReason}</p>}
      </div>

      <section className="space-y-1 rounded-lg border p-4">
        {client.phone && <p>{client.phone}</p>}
        {client.email && <p>{client.email}</p>}
      </section>

      {fieldDefinitions.length > 0 ? (
        <CustomFieldsCard
          entity="request"
          ownerId={request.id}
          definitions={fieldDefinitions}
          values={attributes}
          canEdit
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("detail.asked")}</h2>
        {request.serviceName && <p className="font-medium">{request.serviceName}</p>}
        <dl className="divide-y rounded-lg border">
          {answerFields.map((def) => (
            <div key={def.key} className="grid gap-1 p-3 sm:grid-cols-3">
              <dt className="text-sm font-medium">{def.key in KNOWN_REQUEST_FIELDS ? t(`fields.${def.key}.label`) : humanize(def.key)}</dt>
              <dd className="whitespace-pre-wrap text-sm sm:col-span-2">{answerText(def, detail.answers[def.key], t)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t("detail.when")}</h2>
        {win && (win.days.length > 0 || win.parts.length > 0) ? (
          <p>
            {[...win.days.map((d) => t(`fields.days.d${d}`)), ...win.parts.map((p) => t(`fields.preferred_days.${p}`))].join(", ")}
          </p>
        ) : (
          <p className="text-muted-foreground">{t("detail.noWindows")}</p>
        )}
      </section>

      {photos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("detail.photos")}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p, i) => (
              <li key={p.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.viewUrl} alt={t("detail.photoAlt", { n: i + 1 })} className="aspect-square w-full rounded-[8px] border object-cover" />
                <a href={p.viewUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">
                  {t("detail.viewFull")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("detail.quotes")}</h2>
        {quotes.map((q) => (
          <div key={q.id} className="space-y-3 rounded-lg border p-4">
            <p className="font-medium">{t(`quoteStatuses.${q.status}`)}</p>
            <p>
              {t("detail.total")} {formatCurrency(q.subtotalCents)}
              {q.depositCents > 0 && <> - {t("detail.deposit")} {formatCurrency(q.depositCents)}</>}
            </p>
            {q.sentAt && <p className="text-sm text-muted-foreground">{t("detail.sentOn", { date: date.format(q.sentAt) })}</p>}
            {q.status !== "draft" && <QuoteLinkActions quoteId={q.id} link={q.link} canWithdraw={q.status === "sent"} />}
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          {canQuote && (
            <Button asChild  variant="default">
              <Link href={`/requests/${id}/quote`}>{t("detail.writeQuote")}</Link>
            </Button>
          )}
          {canDecline && <DeclineRequestButton requestId={id} />}
        </div>
      </section>
    </div>
  );
}
