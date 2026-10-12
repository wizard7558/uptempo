import { getExpenseDashboard } from "@/actions/expenses";
import { getT } from "@/lib/terms/server";
import { ExpensesDashboard } from "./expenses-client";

export default async function ExpensesPage() {
  const [data, t] = await Promise.all([getExpenseDashboard(), getT("expenses")]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("page.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("page.subtitle")}</p>
      </div>

      <ExpensesDashboard initialData={data} />
    </div>
  );
}
