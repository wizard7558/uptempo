import { getAnalyticsDashboard } from "@/actions/analytics";
import { autoGranularity } from "@/lib/analytics/granularity";
import { AnalyticsDashboard } from "../analytics-client";
import { startOfMonth, endOfMonth } from "date-fns";

export default async function AnalyticsPage() {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  const granularity = autoGranularity({ start, end });
  const data = await getAnalyticsDashboard({ start, end }, granularity);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Service analytics</h1>
        <p className="text-muted-foreground mt-1">
          Business performance overview, including revenue, expenses, and net.
        </p>
      </div>
      <AnalyticsDashboard initialData={data} />
    </div>
  );
}
