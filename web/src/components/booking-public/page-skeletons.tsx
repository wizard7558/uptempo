import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared skeletons for the booking-group tab pages — used both as
 * loading.tsx (route transitions) and as in-page Suspense fallbacks so the
 * shell can flush before the data queries resolve.
 */

export function BookingPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6 md:max-w-xl lg:max-w-2xl">
      <div className="mb-8 flex items-center justify-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="size-8 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-9 w-52" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function StorePageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6 md:max-w-xl lg:max-w-2xl">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 grid grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-36 w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:px-6 md:max-w-xl lg:max-w-2xl">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-[var(--line)] p-4"
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
