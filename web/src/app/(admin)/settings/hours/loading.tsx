import { Skeleton } from "@/components/ui/skeleton";

export default function WorkingHoursLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1 h-4 w-96" />
      </div>

      <Skeleton className="h-10 w-48" />

      <div className="space-y-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-6 w-10 rounded-full" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
