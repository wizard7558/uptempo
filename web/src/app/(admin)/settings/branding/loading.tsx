import { Skeleton } from "@/components/ui/skeleton";

export default function BrandingSettingsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Colors card */}
        <Skeleton className="h-52 w-full rounded-xl" />

        {/* Logo card */}
        <Skeleton className="h-36 w-full rounded-xl" />

        {/* Font card */}
        <Skeleton className="h-32 w-full rounded-xl" />

        {/* Platform branding card */}
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
