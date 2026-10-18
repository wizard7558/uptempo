"use client";

import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";

/**
 * The business's own record of a card payment: the card processing it paid and
 * what it receives. Shown only to the business, never on client receipts.
 * `feeCents` is the fee stored on the charge, not a recalculation.
 */
export function ProcessingFeeSummary({
  amountCents,
  feeCents,
  rateLabel,
}: {
  amountCents: number;
  feeCents: number;
  rateLabel: string;
}) {
  const t = useT("settings.billing");
  return (
    <div className="space-y-1 text-sm" data-testid="processing-fee-summary">
      <p className="text-muted-foreground">
        {t("feeSummaryLine", { label: rateLabel, fee: formatCurrency(feeCents) })}
      </p>
      <p className="font-medium">
        {t("feeSummaryNet", { net: formatCurrency(amountCents - feeCents) })}
      </p>
    </div>
  );
}
