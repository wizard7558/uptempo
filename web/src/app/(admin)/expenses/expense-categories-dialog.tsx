"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Settings2 } from "lucide-react";
import {
  createExpenseCategory,
  renameExpenseCategory,
  setExpenseCategoryActive,
} from "@/actions/expense-categories";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ExpenseCategoryRow } from "@/lib/expenses/categories";
import { useT } from "@/lib/terms/client";

interface Props {
  categories: ExpenseCategoryRow[];
  onChanged: () => void;
}

export function ExpenseCategoriesDialog({ categories, onChanged }: Props) {
  const t = useT("expenses");
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(
    action: () => Promise<{ success: true } | { success: false; error: string }>,
  ): Promise<boolean> {
    let result: Awaited<ReturnType<typeof action>>;
    try {
      result = await action();
    } catch {
      toast.error(t("categories.failed"));
      return false;
    }
    if (!result.success) {
      toast.error(result.error || t("categories.failed"));
      return false;
    }
    toast.success(t("categories.saved"));
    onChanged();
    return true;
  }

  async function handleRename(row: ExpenseCategoryRow, input: HTMLInputElement) {
    const name = input.value.trim();
    if (name === row.name) return;
    setBusyId(row.id);
    const ok = await run(() => renameExpenseCategory({ id: row.id, name }));
    if (!ok) input.value = row.name;
    setBusyId(null);
  }

  async function handleActive(row: ExpenseCategoryRow, active: boolean) {
    setBusyId(row.id);
    await run(() => setExpenseCategoryActive({ id: row.id, active }));
    setBusyId(null);
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    const ok = await run(() => createExpenseCategory({ name: newName }));
    setAdding(false);
    if (ok) setNewName("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 w-full sm:w-auto">
          <Settings2 className="mr-2 h-4 w-4" />
          {t("categories.manage")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("categories.title")}</DialogTitle>
          <DialogDescription>{t("categories.description")}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {categories.map((row) => (
            <li key={row.id} className="flex items-center gap-3">
              <Input
                // Remount when the saved name changes so the field shows server state.
                key={`${row.id}-${row.name}`}
                aria-label={t("categories.nameLabel")}
                defaultValue={row.name}
                maxLength={40}
                className="h-11 flex-1"
                disabled={busyId === row.id}
                onBlur={(event) => handleRename(row, event.target)}
              />
              <label className="flex min-h-11 min-w-24 cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={row.isActive}
                  disabled={row.slug === "other" || busyId === row.id}
                  onCheckedChange={(checked) => handleActive(row, checked)}
                  aria-label={row.name}
                />
                <span className="text-muted-foreground">
                  {row.isActive ? t("categories.shown") : t("categories.hiddenState")}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAdd} className="space-y-2 border-t pt-4">
          <Label htmlFor="new-expense-category">{t("categories.addLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="new-expense-category"
              value={newName}
              maxLength={40}
              placeholder={t("categories.addPlaceholder")}
              className="h-11 flex-1"
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button type="submit" className="h-11 min-w-20" disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : t("categories.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
