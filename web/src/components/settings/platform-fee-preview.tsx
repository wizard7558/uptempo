import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { PlatformFeePreview } from "@/actions/billing-preview";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function planLabel(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** Read-only preview of the monthly platform fee: max($50 floor, tier% × revenue). */
export function PlatformFeePreviewCard({
  preview,
  billed = false,
}: {
  preview: PlatformFeePreview;
  /** True once this salon is on paid billing (changes the footer note). */
  billed?: boolean;
}) {
  const {
    plan,
    feePercent,
    floorCents,
    monthlyRevenueCents,
    percentFeeCents,
    chargeCents,
    isFloor,
    breakEvenRevenueCents,
    periodLabel,
  } = preview;

  const exempt = feePercent === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Uptempo plan</CardTitle>
        <CardDescription>
          {planLabel(plan)} plan — {usd(floorCents)}/month minimum
          {exempt ? " (fee-exempt)" : `, then ${feePercent}% of revenue`}. You
          pay the greater of the {usd(floorCents)} floor or {exempt ? "0" : feePercent}%
          of your monthly revenue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Estimated fee — {periodLabel}
          </p>
          <p className="text-3xl font-semibold tabular-nums">
            {usd(chargeCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {exempt
              ? "Your account is fee-exempt."
              : isFloor
                ? `You're on the ${usd(floorCents)} floor — it covers you up to ${breakEvenRevenueCents != null ? usd(breakEvenRevenueCents) : "—"} of monthly revenue.`
                : `${feePercent}% of your revenue exceeds the ${usd(floorCents)} floor.`}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Revenue this month</dt>
          <dd className="text-right tabular-nums">{usd(monthlyRevenueCents)}</dd>
          <dt className="text-muted-foreground">Your rate</dt>
          <dd className="text-right tabular-nums">
            {exempt ? "Exempt" : `${feePercent}%`}
          </dd>
          {!exempt ? (
            <>
              <dt className="text-muted-foreground">Rate on revenue</dt>
              <dd className="text-right tabular-nums">{usd(percentFeeCents)}</dd>
              <dt className="text-muted-foreground">Monthly floor</dt>
              <dd className="text-right tabular-nums">{usd(floorCents)}</dd>
            </>
          ) : null}
        </dl>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {billed
            ? "Billed monthly to your card on file after the month closes."
            : "Preview only — no platform fees are charged during your beta."}
        </p>
      </CardContent>
    </Card>
  );
}
