import { getRevenueReport } from "@/actions/revenue";
import { RevenueDashboard } from "@/components/admin/revenue-dashboard";
import { getT } from "@/lib/terms/server";
import { startOfMonth, endOfMonth } from "date-fns";

export default async function RevenuePage() {
  const t = await getT("reports");
  const now = new Date();
  const report = await getRevenueReport({
    start: startOfMonth(now),
    end: endOfMonth(now),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Revenue</h1>
        <p className="text-muted-foreground mt-1">
          {t("revenuePage.subtitle")}
        </p>
      </div>
      <RevenueDashboard initialData={report} />
    </div>
  );
}
