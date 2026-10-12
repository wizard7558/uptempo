"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createExpense,
  deleteExpense,
  getExpenseDashboard,
  updateExpense,
} from "@/actions/expenses";
import { formatCurrency } from "@/components/ui/chart-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExpenseCategoryRow } from "@/lib/expenses/categories";
import { useT } from "@/lib/terms/client";
import { ExpenseCategoriesDialog } from "./expense-categories-dialog";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ExpenseDashboardData = Awaited<ReturnType<typeof getExpenseDashboard>>;
type ExpenseRow = ExpenseDashboardData["expenses"][number];
type ExpenseFilterCategory = string;

interface ExpensesDashboardProps {
  initialData: ExpenseDashboardData;
}

interface ExpenseFormState {
  id: string | null;
  expenseDate: string;
  vendorName: string;
  category: string;
  amount: string;
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildEmptyForm(categories: ExpenseCategoryRow[]): ExpenseFormState {
  return {
    id: null,
    expenseDate: new Date().toISOString().slice(0, 10),
    vendorName: "",
    category: categories.find((c) => c.isActive)?.slug ?? "other",
    amount: "",
  };
}

function buildEditForm(expense: ExpenseRow): ExpenseFormState {
  return {
    id: expense.id,
    expenseDate: expense.expenseDate,
    vendorName: expense.vendorName,
    category: expense.category,
    amount: (expense.amountCents / 100).toFixed(2),
  };
}

function SummaryBlock({
  title,
  description,
  totalCents,
  rows,
}: {
  title: string;
  description: string;
  totalCents: number;
  rows: Array<{ category: string; label: string; totalCents: number }>;
}) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold">{formatCurrency(totalCents)}</div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.category}
              className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium">{formatCurrency(row.totalCents)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ExpensesDashboard({
  initialData,
}: ExpensesDashboardProps) {
  const t = useT("expenses");
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState({
    startDate: initialData.filters.startDate ?? "",
    endDate: initialData.filters.endDate ?? "",
    category: initialData.filters.category as ExpenseFilterCategory,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(() =>
    buildEmptyForm(initialData.categories),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasFilters = useMemo(
    () =>
      filters.startDate.trim() !== "" ||
      filters.endDate.trim() !== "" ||
      filters.category !== "all",
    [filters],
  );

  function refreshDashboard(nextFilters = filters) {
    startTransition(async () => {
      const nextData = await getExpenseDashboard({
        startDate: nextFilters.startDate || undefined,
        endDate: nextFilters.endDate || undefined,
        category: nextFilters.category,
      });
      setData(nextData);
    });
  }

  const categoryLabels = useMemo(
    () => new Map(data.categories.map((c) => [c.slug, c.name])),
    [data.categories],
  );
  const activeCategories = data.categories.filter((c) => c.isActive);
  const hiddenCategories = data.categories.filter((c) => !c.isActive);

  function openCreateDialog() {
    setForm(buildEmptyForm(data.categories));
    setDialogOpen(true);
  }

  function openEditDialog(expense: ExpenseRow) {
    setForm(buildEditForm(expense));
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(form.amount);
    const amountCents = Math.round(parsedAmount * 100);

    if (!form.vendorName.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    if (!form.expenseDate) {
      toast.error("Expense date is required");
      return;
    }
    if (!Number.isFinite(parsedAmount) || amountCents <= 0) {
      toast.error("Amount must be greater than $0.00");
      return;
    }

    setIsSaving(true);

    const payload = {
      expenseDate: form.expenseDate,
      vendorName: form.vendorName.trim(),
      category: form.category,
      amountCents,
    };

    const result = form.id
      ? await updateExpense({ id: form.id, ...payload })
      : await createExpense(payload);

    setIsSaving(false);

    if (!result.success) {
      const error = "error" in result ? result.error : null;
      const message =
        error && typeof error === "object" && "message" in error
          ? (error as { message: string }).message
          : "Failed to save expense";
      toast.error(message);
      return;
    }

    toast.success(form.id ? "Expense updated" : "Expense added");
    setDialogOpen(false);
    setForm(buildEmptyForm(data.categories));
    refreshDashboard();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const result = await deleteExpense(id);
    setDeletingId(null);

    if (!result.success) {
      const error = "error" in result ? result.error : null;
      const message =
        error && typeof error === "object" && "message" in error
          ? (error as { message: string }).message
          : "Failed to delete expense";
      toast.error(message);
      return;
    }

    toast.success("Expense deleted");
    refreshDashboard();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>
              Narrow your expense list by date range or category.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ExpenseCategoriesDialog
              categories={data.categories}
              onChanged={() => refreshDashboard()}
            />
            <Button onClick={openCreateDialog} className="h-11 w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 xl:grid xl:grid-cols-[1fr_1fr_220px_auto_auto] xl:items-end xl:gap-4 xl:space-y-0">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:contents">
            <div className="space-y-2">
              <Label htmlFor="expense-filter-start">Start date</Label>
              <Input
                id="expense-filter-start"
                type="date"
                value={filters.startDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expense-filter-end">End date</Label>
              <Input
                id="expense-filter-end"
                type="date"
                value={filters.endDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2 xl:col-span-1">
              <Label htmlFor="expense-filter-category">Category</Label>
              <Select
                value={filters.category}
                onValueChange={(value) =>
                  setFilters((current) => ({
                    ...current,
                    category: value as ExpenseFilterCategory,
                  }))
                }
              >
                <SelectTrigger id="expense-filter-category" className="w-full">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {activeCategories.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {hiddenCategories.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {`${c.name} (${t("categories.hidden")})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:contents">
            <Button
              className="w-full xl:w-auto"
              onClick={() => refreshDashboard()}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
            <Button
              variant="outline"
              className="w-full xl:w-auto"
              disabled={!hasFilters || isPending}
              onClick={() => {
                const cleared = {
                  startDate: "",
                  endDate: "",
                  category: "all" as const,
                };
                setFilters(cleared);
                refreshDashboard(cleared);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Filtered Total</CardTitle>
            <CardDescription>
              {data.totals.count} expense{data.totals.count === 1 ? "" : "s"} in view
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-semibold">
              {formatCurrency(data.totals.totalCents)}
            </div>
            <div className="flex flex-wrap gap-2">
              {data.totals.byCategory.map((row) => (
                <Badge key={row.category} variant="secondary">
                  {row.label}: {formatCurrency(row.totalCents)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <SummaryBlock
          title="This Week"
          description="Running total by expense category."
          totalCents={data.currentWeek.totalCents}
          rows={data.currentWeek.byCategory}
        />

        <SummaryBlock
          title="This Month"
          description="Monthly spend snapshot for quick check-ins."
          totalCents={data.currentMonth.totalCents}
          rows={data.currentMonth.byCategory}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expenses</CardTitle>
          <CardDescription>
            Entered expenses are sorted newest first for between-client updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.expenses.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No expenses yet. Add your first product or supply purchase to start tracking.
            </div>
          ) : (
            data.expenses.map((expense) => (
              <div
                key={expense.id}
                className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{expense.vendorName}</p>
                    <Badge variant="outline">
                      {categoryLabels.get(expense.category) ?? expense.category}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>{formatDateLabel(expense.expenseDate)}</span>
                    <span>{formatCurrency(expense.amountCents)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="outline"
                    
                    onClick={() => openEditDialog(expense)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    
                    onClick={() => handleDelete(expense.id)}
                    disabled={deletingId === expense.id}
                  >
                    {deletingId === expense.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Expense" : "Add Expense"}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={form.expenseDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expenseDate: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-vendor">Store or vendor</Label>
              <Input
                id="expense-vendor"
                value={form.vendorName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    vendorName: event.target.value,
                  }))
                }
                placeholder={t("form.vendorPlaceholder")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="expense-category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      category: value,
                    }))
                  }
                >
                  <SelectTrigger id="expense-category" className="w-full">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((c) => (
                      <SelectItem key={c.slug} value={c.slug}>
                        {c.name}
                      </SelectItem>
                    ))}
                    {hiddenCategories
                      .filter((c) => c.slug === form.category)
                      .map((c) => (
                        <SelectItem key={c.slug} value={c.slug}>
                          {`${c.name} (${t("categories.hidden")})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="42.50"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : form.id ? (
                  "Save Changes"
                ) : (
                  "Add Expense"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
