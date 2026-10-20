"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { waiveCharge, refundCharge } from "@/actions/charges";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";

interface ChargeLogEntry {
  id: string;
  clientName: string;
  appointmentId: string | null;
  amountCents: number;
  reason: string;
  status: string;
  failureReason: string | null;
  /** Stored card processing fee; null or 0 when none was taken. */
  platformFeeCents?: number | null;
  createdAt: Date;
}

interface ChargeLogProps {
  charges: ChargeLogEntry[];
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    case "refunded":
    case "waived":
      return "outline";
    default:
      return "secondary";
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "no_show":
      return "No-show";
    case "late_cancellation":
      return "Late cancellation";
    case "service_payment":
      return "Service payment";
    case "package_sale":
      return "Pack sale";
    default:
      return reason;
  }
}

export function ChargeLog({ charges }: ChargeLogProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const router = useRouter();
  const t = useT("settings.billing");

  async function handleWaive(chargeId: string) {
    setActionLoading(chargeId);
    const result = await waiveCharge(chargeId);
    setActionLoading(null);

    if (result.success) {
      toast.success("Charge waived");
      router.refresh();
    } else {
      toast.error("error" in result ? result.error : "Failed to waive charge");
    }
  }

  async function handleRefund(chargeId: string) {
    setActionLoading(chargeId);
    const result = await refundCharge(chargeId);
    setActionLoading(null);

    if (result.success) {
      toast.success("Charge refunded");
      router.refresh();
    } else {
      toast.error(
        "error" in result ? result.error : "Failed to refund charge",
      );
    }
  }

  if (charges.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-muted-foreground">
          No charges yet. Charges will appear here when no-show or late
          cancellation fees are applied.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile card layout */}
      <div className="space-y-3 md:hidden">
        {charges.map((charge) => (
          <div key={charge.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium truncate">{charge.clientName}</span>
              <div className="flex items-center gap-1 shrink-0">
                {charge.status === "failed" && (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )}
                <Badge variant={statusBadgeVariant(charge.status)}>
                  {charge.status}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span>${(charge.amountCents / 100).toFixed(2)}</span>
              {(charge.platformFeeCents ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">
                    {t("chargesFeeColumn")}
                  </span>
                  <span>{formatCurrency(charge.platformFeeCents ?? 0)}</span>
                </>
              )}
              <span className="text-muted-foreground">Reason</span>
              <span>{reasonLabel(charge.reason)}</span>
              <span className="text-muted-foreground">Date</span>
              <span>{format(new Date(charge.createdAt), "MMM d, yyyy")}</span>
            </div>
            {charge.status === "failed" && charge.failureReason && (
              <p className="text-xs text-destructive">{charge.failureReason}</p>
            )}
            <div className="flex gap-2 pt-1 border-t">
              {(charge.status === "pending" ||
                charge.status === "completed") && (
                <Button
                  variant="ghost"
                  
                  className="h-7 px-2 text-xs"
                  disabled={actionLoading === charge.id}
                  onClick={() => handleWaive(charge.id)}
                >
                  Waive
                </Button>
              )}
              {charge.status === "completed" && (
                <Button
                  variant="ghost"
                  
                  className="h-7 px-2 text-xs"
                  disabled={actionLoading === charge.id}
                  onClick={() => handleRefund(charge.id)}
                >
                  Refund
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table layout */}
    <div className="hidden md:block rounded-md border">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_120px_120px_100px_140px_100px_120px] gap-2 border-b bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground">
        <div>Client</div>
        <div>Amount</div>
        <div>{t("chargesFeeColumn")}</div>
        <div>Reason</div>
        <div>Date</div>
        <div>Status</div>
        <div>Actions</div>
      </div>

      {/* Charge rows */}
      {charges.map((charge) => (
        <div
          key={charge.id}
          className="grid grid-cols-[1fr_120px_120px_100px_140px_100px_120px] gap-2 border-b px-4 py-3 text-sm items-center last:border-b-0"
        >
          <div className="font-medium truncate">{charge.clientName}</div>
          <div>${(charge.amountCents / 100).toFixed(2)}</div>
          <div className="text-muted-foreground">
            {(charge.platformFeeCents ?? 0) > 0
              ? formatCurrency(charge.platformFeeCents ?? 0)
              : ""}
          </div>
          <div className="text-muted-foreground">
            {reasonLabel(charge.reason)}
          </div>
          <div className="text-muted-foreground">
            {format(new Date(charge.createdAt), "MMM d, yyyy h:mm a")}
          </div>
          <div className="flex items-center gap-1">
            {charge.status === "failed" && (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            )}
            <Badge variant={statusBadgeVariant(charge.status)}>
              {charge.status}
            </Badge>
            {charge.status === "failed" && charge.failureReason && (
              <span
                className="text-xs text-destructive truncate max-w-[120px]"
                title={charge.failureReason}
              >
                {charge.failureReason}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(charge.status === "pending" ||
              charge.status === "completed") && (
              <Button
                variant="ghost"
                
                className="h-7 px-2 text-xs"
                disabled={actionLoading === charge.id}
                onClick={() => handleWaive(charge.id)}
              >
                Waive
              </Button>
            )}
            {charge.status === "completed" && (
              <Button
                variant="ghost"
                
                className="h-7 px-2 text-xs"
                disabled={actionLoading === charge.id}
                onClick={() => handleRefund(charge.id)}
              >
                Refund
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
    </>
  );
}
