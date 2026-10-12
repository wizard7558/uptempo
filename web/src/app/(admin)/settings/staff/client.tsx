"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StaffForm } from "@/components/settings/staff-form";
import { StaffBooksSection } from "@/components/settings/staff-books-section";
import { StaffTravelSection } from "@/components/settings/staff-travel-section";
import { deactivateStaffMember } from "@/actions/staff";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import { Plus, Pencil, UserX, User, ListChecks } from "lucide-react";

interface StaffMember {
  id: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  photoUrl: string | null;
  role: string;
  defaultAssistantId: string | null;
  booksMode: "open" | "windows" | "closed";
  services: Array<{ serviceId: string; serviceName: string }>;
}

interface StaffPageClientProps {
  initialStaff: StaffMember[];
  assistants: Array<{ id: string; displayName: string }>;
  /** The on_site module is on: show each person's travel settings. */
  onSiteEnabled?: boolean;
}

export function StaffPageClient({
  initialStaff,
  assistants,
  onSiteEnabled = false,
}: StaffPageClientProps) {
  const t = useT("settings");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingStaffMember, setEditingStaffMember] = useState<StaffMember | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function handleSuccess() {
    setAddDialogOpen(false);
    setEditingStaffMember(null);
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Are you sure you want to deactivate ${name}?`)) return;

    const result = await deactivateStaffMember(id);
    if (result.success) {
      toast.success(`${name} has been deactivated`);
      startTransition(() => {
        router.refresh();
      });
    } else {
      toast.error(t("staffClient.deactivateFailed"));
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            {t("staffClient.addButton")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("staffClient.addTitle")}</DialogTitle>
          </DialogHeader>
          <StaffForm assistants={assistants} onSuccess={handleSuccess} />
        </DialogContent>
      </Dialog>

      {initialStaff.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
          <User className="mx-auto mb-3 size-10 opacity-40" />
          <p>{t("staffClient.empty")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialStaff.map((staffMember) => (
            <Card key={staffMember.id}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                    <User className="text-muted-foreground size-5" />
                  </div>
                  <CardTitle className="text-base">
                    {staffMember.displayName}
                  </CardTitle>
                </div>
                <div className="flex gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          href={`/settings/staff/${staffMember.id}/services`}
                          aria-label={`Manage services & pricing for ${staffMember.displayName}`}
                        >
                          <ListChecks />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("staffClient.servicesTooltip")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingStaffMember(staffMember)}
                        aria-label={`Edit ${staffMember.displayName}`}
                      >
                        <Pencil />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Edit profile (name, email, phone)
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleDeactivate(staffMember.id, staffMember.displayName)
                        }
                        aria-label={`Deactivate ${staffMember.displayName}`}
                      >
                        <UserX />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("staffClient.deactivateTooltip")}</TooltipContent>
                  </Tooltip>
                </div>
              </CardHeader>
              <CardContent>
                {staffMember.services.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {staffMember.services.map((s) => (
                      <Badge key={s.serviceId} variant="secondary">
                        {s.serviceName}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("staffClient.noServices")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!editingStaffMember}
        onOpenChange={(open) => !open && setEditingStaffMember(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("staffClient.editTitle")}</DialogTitle>
          </DialogHeader>
          {editingStaffMember && (
            <StaffForm
              staffMember={editingStaffMember}
              assistants={assistants}
              onSuccess={handleSuccess}
            />
          )}
          {editingStaffMember && (
            <StaffBooksSection
              key={editingStaffMember.id}
              staffId={editingStaffMember.id}
              initialMode={editingStaffMember.booksMode}
            />
          )}
          {editingStaffMember && onSiteEnabled && (
            <StaffTravelSection staffId={editingStaffMember.id} />
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
