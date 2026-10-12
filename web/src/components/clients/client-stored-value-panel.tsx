"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enrollClientInMembershipPlan,
  cancelClientMembership,
  adminTransferStoredValue,
  adminAdjustStoredValue,
} from "@/actions/membership";
import { toast } from "sonner";
import { format } from "date-fns";

interface PlanOption {
  id: string;
  name: string;
  monthlyAmountCents: number;
}

interface TxRow {
  id: string;
  type: string;
  amountCents: number;
  runningBalanceCents: number;
  note: string | null;
  createdAt: Date;
}

interface MembershipInfo {
  id: string;
  status: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  planName: string;
  planId: string;
  monthlyAmountCents: number;
}

interface Props {
  clientId: string;
  balanceCents: number;
  membership: MembershipInfo | null;
  transactions: TxRow[];
  plans: PlanOption[];
}

export function ClientStoredValuePanel({
  clientId,
  balanceCents,
  membership,
  transactions,
  plans,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [adjustAmt, setAdjustAmt] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  function enroll() {
    if (!planId) {
      toast.error("Create a membership plan in Settings first");
      return;
    }
    startTransition(async () => {
      const r = await enrollClientInMembershipPlan({ clientId, planId });
      if (r.success) {
        toast.success("Enrolled in membership");
        window.location.reload();
      } else {
        toast.error("error" in r ? r.error : "Failed");
      }
    });
  }

  function cancel() {
    startTransition(async () => {
      const r = await cancelClientMembership(clientId);
      if (r.success) {
        toast.success("Membership cancelled");
        window.location.reload();
      } else {
        toast.error("error" in r ? r.error : "Failed");
      }
    });
  }

  function transfer() {
    const dollars = Number.parseFloat(transferAmt);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const cents = Math.round(dollars * 100);
    startTransition(async () => {
      const r = await adminTransferStoredValue({
        fromClientId: clientId,
        toClientId: transferTo.trim(),
        amountCents: cents,
      });
      if (r.success) {
        toast.success("Transfer complete");
        window.location.reload();
      } else {
        toast.error("Transfer failed");
      }
    });
  }

  function adjust() {
    const dollars = Number.parseFloat(adjustAmt);
    if (!Number.isFinite(dollars) || dollars === 0) {
      toast.error("Enter a non-zero adjustment in dollars (+ or -)");
      return;
    }
    const cents = Math.round(dollars * 100);
    startTransition(async () => {
      const r = await adminAdjustStoredValue({
        clientId,
        amountCents: cents,
        note: adjustNote || undefined,
      });
      if (r.success) {
        toast.success("Balance updated");
        window.location.reload();
      } else {
        toast.error("error" in r ? r.error : "Failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">Current balance</p>
        <p className="text-3xl font-semibold tabular-nums">
          ${(balanceCents / 100).toFixed(2)}
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium">Membership</h3>
        {membership ? (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{membership.planName}</strong> — {membership.status}
            </p>
            {membership.currentPeriodEnd && (
              <p className="text-muted-foreground">
                Period ends{" "}
                {format(new Date(membership.currentPeriodEnd), "MMM d, yyyy")}
              </p>
            )}
            <Button
              variant="outline"
              
              onClick={cancel}
              disabled={pending}
            >
              Cancel membership
            </Button>
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a plan under Settings → Memberships first.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Plan</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (${(p.monthlyAmountCents / 100).toFixed(2)}/mo)
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={enroll} disabled={pending}>
              Enroll
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium">Transfer to another client</h3>
        <p className="text-xs text-muted-foreground">
          Enter the recipient&apos;s client ID (from their profile URL).
        </p>
        <div className="grid gap-2 max-w-md">
          <Input
            placeholder="Recipient client ID"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Amount (USD)"
            value={transferAmt}
            onChange={(e) => setTransferAmt(e.target.value)}
          />
          <Button variant="secondary" onClick={transfer} disabled={pending}>
            Transfer
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium">Manual adjustment</h3>
        <div className="grid gap-2 max-w-md">
          <Input
            type="number"
            step="0.01"
            placeholder="Amount in USD (+ credit / - debit)"
            value={adjustAmt}
            onChange={(e) => setAdjustAmt(e.target.value)}
          />
          <Input
            placeholder="Note (optional)"
            value={adjustNote}
            onChange={(e) => setAdjustNote(e.target.value)}
          />
          <Button variant="secondary" onClick={adjust} disabled={pending}>
            Apply adjustment
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-medium">Recent activity</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {transactions.map((t) => (
              <li
                key={t.id}
                className="flex justify-between gap-4 border-b border-border/60 pb-2 last:border-0"
              >
                <span className="text-muted-foreground">
                  {format(new Date(t.createdAt), "MMM d, h:mm a")} · {t.type}
                </span>
                <span className="tabular-nums">
                  {t.amountCents >= 0 ? "+" : ""}
                  {(t.amountCents / 100).toFixed(2)} → bal{" "}
                  {(t.runningBalanceCents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
