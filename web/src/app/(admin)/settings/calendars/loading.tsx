import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarSettingsLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-1 h-4 w-96" />
      </div>

      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
