"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import { updateBusinessSettings } from "@/actions/policies";

type Audience = "both" | "existing_only" | "new_only";
type DepositType = "percent" | "fixed";

interface PolicyFormProps {
  /** Optional: invoked after a successful save (used by the onboarding wizard). */
  onSaved?: () => void;
  initialPolicy: {
    cancellationWindowHours: number;
    cancellationFeePercent: number;
    noShowFeePercent: number;
    requireCardOnFile: number;
    policyText: string | null;
    onlineBookingAudience: Audience;
    depositEnabled: number;
    depositDefaultType: DepositType;
    depositDefaultAmount: number;
    depositDurationThresholdMinutes: number | null;
  };
}

export function PolicyForm({ onSaved, initialPolicy }: PolicyFormProps) {
  const t = useT("settings");
  const [cancellationWindowHours, setCancellationWindowHours] = useState(
    initialPolicy.cancellationWindowHours,
  );
  const [cancellationFeePercent, setCancellationFeePercent] = useState(
    initialPolicy.cancellationFeePercent,
  );
  const [noShowFeePercent, setNoShowFeePercent] = useState(
    initialPolicy.noShowFeePercent,
  );
  const [requireCardOnFile, setRequireCardOnFile] = useState(
    initialPolicy.requireCardOnFile,
  );
  const [policyText, setPolicyText] = useState(initialPolicy.policyText ?? "");
  const [audience, setAudience] = useState<Audience>(
    initialPolicy.onlineBookingAudience,
  );
  const [depositEnabled, setDepositEnabled] = useState(
    initialPolicy.depositEnabled === 1,
  );
  const [depositDefaultType, setDepositDefaultType] = useState<DepositType>(
    initialPolicy.depositDefaultType,
  );
  const [depositAmountStr, setDepositAmountStr] = useState(
    initialPolicy.depositDefaultType === "fixed"
      ? (initialPolicy.depositDefaultAmount / 100).toFixed(2)
      : String(initialPolicy.depositDefaultAmount || ""),
  );
  const [thresholdStr, setThresholdStr] = useState(
    initialPolicy.depositDurationThresholdMinutes != null
      ? String(initialPolicy.depositDurationThresholdMinutes)
      : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    const depositDefaultAmount =
      depositDefaultType === "fixed"
        ? Math.round(Number(depositAmountStr) * 100)
        : parseInt(depositAmountStr, 10) || 0;
    const thresholdTrimmed = thresholdStr.trim();
    const depositDurationThresholdMinutes =
      thresholdTrimmed === "" ? null : parseInt(thresholdTrimmed, 10);

    try {
      const result = await updateBusinessSettings({
        cancellationWindowHours,
        cancellationFeePercent,
        noShowFeePercent,
        requireCardOnFile,
        policyText: policyText.trim() === "" ? null : policyText,
        onlineBookingAudience: audience,
        depositEnabled: depositEnabled ? 1 : 0,
        depositDefaultType,
        depositDefaultAmount: Number.isFinite(depositDefaultAmount)
          ? Math.max(0, depositDefaultAmount)
          : 0,
        depositDurationThresholdMinutes,
      });

      if (!result.success) {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? result.error.message
            : "Failed to update policy",
        );
        return;
      }

      toast.success("Policies updated");
      onSaved?.();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <Label htmlFor="policyText">{t("policyForm.label")}</Label>
        <Textarea
          id="policyText"
          value={policyText}
          onChange={(e) => setPolicyText(e.target.value)}
          rows={10}
          placeholder={
            "Outline your cancellation policy, lateness policy, refund policy, photo release, and anything else you'd like clients to acknowledge before their first appointment."
          }
        />
        <p className="text-muted-foreground text-xs">
          Sent to clients via the &quot;Send intake link&quot; action on an
          appointment. Clients review, sign, and add a card on file in the
          same step.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cancellationWindowHours">
          Cancellation Window (hours)
        </Label>
        <Input
          id="cancellationWindowHours"
          type="number"
          min={0}
          max={168}
          value={cancellationWindowHours}
          onChange={(e) =>
            setCancellationWindowHours(parseInt(e.target.value, 10) || 0)
          }
        />
        <p className="text-muted-foreground text-xs">
          How many hours before the appointment a client can cancel without a
          fee.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cancellationFeePercent">
          Late Cancellation Fee (%)
        </Label>
        <Input
          id="cancellationFeePercent"
          type="number"
          min={0}
          max={100}
          value={cancellationFeePercent}
          onChange={(e) =>
            setCancellationFeePercent(parseInt(e.target.value, 10) || 0)
          }
        />
        <p className="text-muted-foreground text-xs">
          Percentage of service cost charged for late cancellations.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="noShowFeePercent">No-Show Fee (%)</Label>
        <Input
          id="noShowFeePercent"
          type="number"
          min={0}
          max={100}
          value={noShowFeePercent}
          onChange={(e) =>
            setNoShowFeePercent(parseInt(e.target.value, 10) || 0)
          }
        />
        <p className="text-muted-foreground text-xs">
          Percentage of service cost charged when a client does not show up.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="requireCardOnFile">Require Card on File</Label>
        <div className="flex items-center gap-3">
          <Switch
            id="requireCardOnFile"
            checked={requireCardOnFile === 1}
            onCheckedChange={(checked) =>
              setRequireCardOnFile(checked ? 1 : 0)
            }
          />
          <span className="text-sm text-muted-foreground">
            Clients must save a card to complete a booking
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onlineBookingAudience">Who can book online</Label>
        <Select
          value={audience}
          onValueChange={(v) => setAudience(v as Audience)}
        >
          <SelectTrigger id="onlineBookingAudience" className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Everyone</SelectItem>
            <SelectItem value="existing_only">Existing clients only</SelectItem>
            <SelectItem value="new_only">New clients only</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Controls who can self-book on your public booking page. Staff can
          always book anyone from the dashboard.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch
            id="depositEnabled"
            checked={depositEnabled}
            onCheckedChange={setDepositEnabled}
          />
          <Label htmlFor="depositEnabled" className="cursor-pointer">
            Require a deposit at booking
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">
          The default rule below applies to every service unless that service
          sets its own deposit. Leave the duration blank to apply to all
          services, or set it to only charge a deposit on longer appointments
          (e.g. 240 = 4+ hours).
        </p>
        {depositEnabled && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="depositDefaultType">Deposit type</Label>
              <Select
                value={depositDefaultType}
                onValueChange={(v) => setDepositDefaultType(v as DepositType)}
              >
                <SelectTrigger id="depositDefaultType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent of price</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="depositDefaultAmount">
                {depositDefaultType === "percent" ? "Percent (1–100)" : "Amount ($)"}
              </Label>
              <Input
                id="depositDefaultAmount"
                type="number"
                min={0}
                max={depositDefaultType === "percent" ? 100 : undefined}
                step={depositDefaultType === "percent" ? 1 : 0.01}
                value={depositAmountStr}
                onChange={(e) => setDepositAmountStr(e.target.value)}
                placeholder={depositDefaultType === "percent" ? "25" : "50.00"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="depositThreshold">Min. duration (min)</Label>
              <Input
                id="depositThreshold"
                type="number"
                min={0}
                max={1440}
                value={thresholdStr}
                onChange={(e) => setThresholdStr(e.target.value)}
                placeholder="All services"
              />
            </div>
          </div>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save Policy"}
      </Button>
    </form>
  );
}
