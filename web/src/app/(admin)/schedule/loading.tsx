import { Skeleton } from "@/components/ui/skeleton";

export default function ScheduleLoading() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      {/* Date nav bar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>

      {/* Schedule grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Time column */}
        <div className="w-16 shrink-0 border-r pt-4">
          <div className="space-y-8 px-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-10" />
            ))}
          </div>
        </div>

        {/* Staff columns */}
        <div className="flex flex-1">
          {Array.from({ length: 3 }).map((_, col) => (
            <div key={col} className="flex-1 border-r p-3 last:border-r-0">
              <Skeleton className="mb-4 h-6 w-24" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, row) => (
                  <Skeleton key={row} className="h-16 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
