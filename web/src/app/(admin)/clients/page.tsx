import Link from "next/link";
import { listClients } from "@/actions/clients";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { ClientList } from "@/components/clients/client-list";
import { ClientCreateDialog } from "@/components/clients/client-create-dialog";
import { Button } from "@/components/ui/button";
import { normalizeClientSort } from "@/lib/clients/sorting";
import { Upload } from "lucide-react";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  const pageValue = typeof query.page === "string" ? Number(query.page) : 1;
  const { sortBy, sortDir } = normalizeClientSort({
    sortBy: query.sort,
    sortDir: query.dir,
  });
  const fieldKey = typeof query.f === "string" ? query.f : "";
  const fieldValue = typeof query.v === "string" ? query.v : "";
  const [clients, definitions] = await Promise.all([
    listClients({
      q,
      page: Number.isFinite(pageValue) ? pageValue : 1,
      pageSize: 25,
      sortBy,
      sortDir,
      attributeFilter: fieldKey && fieldValue ? { key: fieldKey, value: fieldValue } : undefined,
    }),
    listCustomFieldDefinitions("client"),
  ]);
  const filterFields = definitions.filter(
    (field) => field.isActive && (field.type === "select" || field.type === "multi" || field.type === "boolean"),
  );

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage your client profiles, service history, and preferences.
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link href="/clients/import" className="shrink-0">
            <Button variant="outline" className="w-full sm:w-auto">
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
          </Link>
          <ClientCreateDialog />
        </div>
      </div>
      <ClientList data={clients} filterFields={filterFields} />
    </div>
  );
}
