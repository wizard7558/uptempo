import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border/80 bg-card p-6 ${className}`}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-10 w-40" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="space-y-8 p-6">
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-3 w-56" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid gap-6 md:grid-cols-2">
            <PanelSkeleton className="h-64" />
            <PanelSkeleton className="h-64" />
          </div>
          <PanelSkeleton className="h-40" />
          <div className="rounded-xl border border-border/80 bg-card">
            <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PanelSkeleton className="h-32" />
            <PanelSkeleton className="h-32" />
            <PanelSkeleton className="h-32" />
          </div>
        </div>
        <div className="space-y-6">
          <PanelSkeleton className="h-72" />
          <PanelSkeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}
