import { Skeleton } from "@/components/ui/skeleton";

export default function DomainSettingsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Subdomain card */}
        <Skeleton className="h-32 w-full rounded-xl" />

        {/* Custom domain card */}
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );
}
