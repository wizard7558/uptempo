import { Skeleton } from "@/components/ui/skeleton";

export default function GeneralSettingsLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-1 h-4 w-72" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
