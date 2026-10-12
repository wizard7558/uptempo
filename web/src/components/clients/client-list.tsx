"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { archiveClients } from "@/actions/clients";
import type { listClients } from "@/actions/clients";
import { Input } from "@/components/ui/input";
import {
  clientsPageHref,
  getNextClientSortDirection,
  type ClientSortDirection,
  type ClientSortKey,
} from "@/lib/clients/sorting";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import type { FieldDef } from "@/lib/custom-fields/values";

type ClientListData = Awaited<ReturnType<typeof listClients>>;

interface ClientListProps {
  data: ClientListData;
  filterFields: FieldDef[];
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

const sortableColumns: Array<{
  key: ClientSortKey;
  label: string;
  className?: string;
  linkClassName?: string;
}> = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  {
    key: "appointmentsBooked",
    label: "Appts",
    className: "text-center",
    linkClassName: "justify-center",
  },
  { key: "customerSince", label: "Customer Since" },
];

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: ClientSortDirection;
}) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );
}

export function ClientList({ data, filterFields }: ClientListProps) {
  const t = useT("clients");
  const fieldsT = useT("customFields");
  const { clients, total, page, totalPages, query, sortBy, sortDir } = data;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fieldKey = searchParams?.get("f") ?? "";
  const fieldValue = searchParams?.get("v") ?? "";
  const activeField = filterFields.find((field) => field.key === fieldKey);
  const [search, setSearch] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isArchiving, startArchiving] = useTransition();

  // Sync search state when URL changes externally (e.g., back/forward)
  useEffect(() => {
    setSearch(searchParams?.get("q") ?? "");
  }, [searchParams]);

  // Drop selections that are no longer on the current page (e.g. after paging,
  // searching, sorting, or archiving).
  useEffect(() => {
    const visible = new Set(clients.map((c) => c.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [clients]);

  const pageIds = clients.map((c) => c.id);
  const allSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id)) && !allSelected;

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleArchive() {
    const ids = [...selected];
    startArchiving(async () => {
      const result = await archiveClients(ids);
      if (!result.success) {
        toast.error("Failed to delete clients");
        return;
      }
      setConfirmOpen(false);
      setSelected(new Set());
      toast.success(
        `${result.archived} ${result.archived === 1 ? "client" : "clients"} deleted`,
      );
      router.refresh();
    });
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(
          clientsPageHref({
            query: value,
            page: 1,
            sortBy,
            sortDir,
            attributeKey: fieldKey,
            attributeValue: fieldValue,
          }),
        );
      });
    }, 300);
  }

  return (
    <div className="space-y-4">
      {filterFields.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="client-filter-field" className="text-sm font-medium">
              {fieldsT("filter.label")}
            </label>
            <Select
              value={activeField ? fieldKey : undefined}
              onValueChange={(next) => {
                router.replace(
                  clientsPageHref({
                    query,
                    page: 1,
                    sortBy,
                    sortDir,
                    attributeKey: next,
                  }),
                );
              }}
            >
              <SelectTrigger id="client-filter-field" className="w-48">
                <SelectValue placeholder={fieldsT("filter.label")} />
              </SelectTrigger>
              <SelectContent>
                {filterFields.map((field) => (
                  <SelectItem key={field.key} value={field.key}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="client-filter-value" className="text-sm font-medium">
              {fieldsT("filter.value")}
            </label>
            <Select
              value={activeField && fieldValue ? fieldValue : undefined}
              disabled={!activeField}
              onValueChange={(next) => {
                router.replace(
                  clientsPageHref({
                    query,
                    page: 1,
                    sortBy,
                    sortDir,
                    attributeKey: fieldKey,
                    attributeValue: next,
                  }),
                );
              }}
            >
              <SelectTrigger id="client-filter-value" className="w-48">
                <SelectValue placeholder={fieldsT("filter.value")} />
              </SelectTrigger>
              <SelectContent>
                {(activeField?.type === "boolean"
                  ? [
                      { value: "true", label: fieldsT("card.yes") },
                      { value: "false", label: fieldsT("card.no") },
                    ]
                  : (activeField?.options ?? [])
                ).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fieldKey || fieldValue ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                router.replace(
                  clientsPageHref({
                    query,
                    page: 1,
                    sortBy,
                    sortDir,
                  }),
                )
              }
            >
              {fieldsT("filter.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full pl-9"
        />
      </div>

      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {query ? `${total} matching clients` : `${total} clients`}
        </p>
        {selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              variant="ghost"
              
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              variant="destructive"
              
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {clients.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          {query ? "No clients matched your search" : "No clients found"}
        </div>
      ) : (
        <div className="rounded-md border">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all clients on this page"
                    checked={
                      allSelected ? true : someSelected ? "indeterminate" : false
                    }
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                  />
                </TableHead>
                {sortableColumns.map((column) => {
                  const isActive = sortBy === column.key;
                  const nextSortDir = getNextClientSortDirection(
                    sortBy,
                    sortDir,
                    column.key,
                  );

                  return (
                    <TableHead
                      key={column.key}
                      aria-sort={
                        isActive
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className={column.className}
                    >
                      <Link
                        href={clientsPageHref({
                          query,
                          page: 1,
                          sortBy: column.key,
                          sortDir: nextSortDir,
                          attributeKey: fieldKey,
                          attributeValue: fieldValue,
                        })}
                        className={[
                          "inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-primary",
                          column.linkClassName,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span>{column.label}</span>
                        <SortIcon active={isActive} direction={sortDir} />
                      </Link>
                    </TableHead>
                  );
                })}
                <TableHead className="text-right">{t("clientList.prepaidColumn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => {
                const { first, last } = splitName(client.name);
                return (
                  <TableRow
                    key={client.id}
                    tabIndex={0}
                    className="cursor-pointer active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => router.push(`/clients/${client.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/clients/${client.id}`);
                      }
                    }}
                  >
                    <TableCell
                      className="w-10"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        aria-label={`Select ${client.name}`}
                        checked={selected.has(client.id)}
                        onCheckedChange={(checked) =>
                          toggleOne(client.id, checked === true)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium text-primary">
                      {first}
                    </TableCell>
                    <TableCell className="font-medium text-primary">
                      {last || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.email || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.phone ? formatPhone(client.phone) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {client.appointmentsBooked}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.customerSince
                        ? new Date(client.customerSince + "T00:00:00").toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                      {"storedValueBalanceCents" in client &&
                      typeof client.storedValueBalanceCents === "number" &&
                      client.storedValueBalanceCents > 0
                        ? `$${(client.storedValueBalanceCents / 100).toFixed(2)}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          {page <= 1 ? (
            <Button variant="outline"  disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" >
              <Link
                href={clientsPageHref({
                  query,
                  page: page - 1,
                  sortBy,
                  sortDir,
                  attributeKey: fieldKey,
                  attributeValue: fieldValue,
                })}
              >
                Previous
              </Link>
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          {page >= totalPages ? (
            <Button variant="outline"  disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" >
              <Link
                href={clientsPageHref({
                  query,
                  page: page + 1,
                  sortBy,
                  sortDir,
                  attributeKey: fieldKey,
                  attributeValue: fieldValue,
                })}
              >
                Next
              </Link>
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size}{" "}
              {selected.size === 1 ? "client" : "clients"}?
            </DialogTitle>
            <DialogDescription>
              They&apos;ll be archived and hidden from your client list. Their
              appointment and payment history is kept, and you can re-add them
              later. This won&apos;t notify the client.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isArchiving}
            >
              {isArchiving ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
