import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { getBusinessSettings } from "@/actions/policies";
import { listRequests, type RequestFilter } from "@/actions/requests";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FILTERS: RequestFilter[] = ["open", "quoted", "booked", "closed", "all"];

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireModule("requests");
  const { role } = await requireRole("owner", "admin", "provider");
  requirePermission(role, "manage_clients");
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f === show) ?? "open";

  const slug = await getTenantSlug();
  const [t, rows, settings] = await Promise.all([
    getT("requests", slug),
    listRequests(filter),
    getBusinessSettings(),
  ]);
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: settings.timezone });

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">{t("inbox.title")}</h1>

      <form method="get" className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="show">{t("inbox.show")}</Label>
          <NativeSelect id="show" name="show" defaultValue={filter} className="w-56">
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`inbox.filters.${f}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="h-11">
          {t("inbox.show")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("inbox.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inbox.colCustomer")}</TableHead>
              <TableHead>{t("inbox.colWhat")}</TableHead>
              <TableHead>{t("inbox.colReceived")}</TableHead>
              <TableHead>{t("inbox.colStatus")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.clientName}</TableCell>
                <TableCell className="max-w-xs truncate">{r.summary}</TableCell>
                <TableCell>{date.format(r.createdAt)}</TableCell>
                <TableCell>{t(`statuses.${r.status}`)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" className="h-11">
                    <Link href={`/requests/${r.id}`}>{t("inbox.open")}</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
