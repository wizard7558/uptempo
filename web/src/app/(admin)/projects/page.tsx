import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { listProjects, type ProjectFilter } from "@/actions/projects";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewProjectDialog } from "./new-project-dialog";

const FILTERS: ProjectFilter[] = ["active", "complete", "all"];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireModule("projects");
  const { role } = await requireRole("owner", "admin", "provider");
  requirePermission(role, "manage_clients");
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f === show) ?? "active";

  const slug = await getTenantSlug();
  const [t, rows] = await Promise.all([getT("projects", slug), listProjects(filter)]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <NewProjectDialog />
      </div>

      <form method="get" className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="show">{t("show")}</Label>
          <NativeSelect id="show" name="show" defaultValue={filter} className="w-56">
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`filters.${f}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="h-11">
          {t("show")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCustomer")}</TableHead>
              <TableHead>{t("colProject")}</TableHead>
              <TableHead>{t("colStaff")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colProgress")}</TableHead>
              <TableHead>{t("leftToPay")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.clientName}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>{r.staffName ?? t("noStaff")}</TableCell>
                <TableCell>{t(`statuses.${r.status}`)}</TableCell>
                <TableCell>{t("progress", { done: r.doneSessions, total: r.estSessions })}</TableCell>
                <TableCell>{r.leftToPayCents === null ? t("noQuote") : formatCurrency(r.leftToPayCents)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" className="h-11">
                    <Link href={`/projects/${r.id}`}>{t("open")}</Link>
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
