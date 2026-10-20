import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { getT } from "@/lib/terms/server";
import { getStaffMember } from "@/actions/staff";
import { getStaffServiceMatrix } from "@/actions/staff-services";
import { listServiceCategories } from "@/actions/service-categories";
import { StaffServicesEditor } from "@/components/settings/staff-services-editor";

export default async function StaffServicesPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const t = await getT("settings");
  const [staffMember, matrix, categories] = await Promise.all([
    getStaffMember(staffId),
    getStaffServiceMatrix(staffId),
    listServiceCategories(),
  ]);

  if (!staffMember) notFound();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost"  className="-ml-2 mb-2">
            <Link href="/settings/staff">
              <ChevronLeft className="size-4" />
              {t("staffServicesPage.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            {staffMember.displayName}&apos;s services
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t("staffServicesPage.subtitle")}
          </p>
        </div>
      </div>

      <StaffServicesEditor
        staffId={staffId}
        initialMatrix={matrix}
        categories={categories}
      />
    </div>
  );
}
