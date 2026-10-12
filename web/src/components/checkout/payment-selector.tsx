"use client";

import { useT } from "@/lib/terms/client";
import { CreditCard, Plus, Banknote, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaymentMethod =
  | "card_on_file"
  | "new_card"
  | "cash"
  | "beauty_bank";

interface PaymentSelectorProps {
  hasCardOnFile: boolean;
  onSelect: (method: PaymentMethod) => void;
  selectedMethod: PaymentMethod | null;
  disabled?: boolean;
  /** Member can pay full discounted services from BB (still disabled if tip > 0). */
  eligibleForFullBb: boolean;
  tipCents: number;
  memberDiscountPercent: number;
}

const cardOptions: {
  value: Exclude<PaymentMethod, "beauty_bank">;
  label: string;
  icon: typeof CreditCard;
  requiresCard?: boolean;
}[] = [
  {
    value: "card_on_file",
    label: "Card on File",
    icon: CreditCard,
    requiresCard: true,
  },
  { value: "new_card", label: "New Card", icon: Plus },
  { value: "cash", label: "Cash", icon: Banknote },
];

export function PaymentSelector({
  hasCardOnFile,
  onSelect,
  selectedMethod,
  disabled,
  eligibleForFullBb,
  tipCents,
  memberDiscountPercent,
}: PaymentSelectorProps) {
  const t = useT("booking");
  const storedValueUsable = eligibleForFullBb && tipCents === 0;
  const storedValueTitle = !eligibleForFullBb
    ? t("paymentSelector.needsMembership")
    : tipCents > 0
      ? t("paymentSelector.removeTip")
      : `${t("paymentSelector.payServices")}${memberDiscountPercent > 0 ? ` ${t("paymentSelector.memberDiscount", { percent: memberDiscountPercent })}` : ""}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {cardOptions.map((opt) => {
          const isDisabled =
            disabled || (opt.requiresCard && !hasCardOnFile);
          const isSelected = selectedMethod === opt.value;
          const Icon = opt.icon;

          return (
            <button
              key={opt.value}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(opt.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
                isSelected
                  ? "ring-2 ring-primary border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
                isDisabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium">{opt.label}</span>
              {opt.requiresCard && !hasCardOnFile && (
                <span className="text-xs text-muted-foreground">
                  No card saved
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        title={storedValueTitle}
        disabled={disabled || !storedValueUsable}
        onClick={() => onSelect("beauty_bank")}
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
          selectedMethod === "beauty_bank"
            ? "ring-2 ring-primary border-primary bg-primary/5"
            : "border-border hover:bg-muted/50",
          (disabled || !storedValueUsable) && "opacity-50 cursor-not-allowed",
        )}
      >
        <Wallet className="h-5 w-5" />
        <span className="font-medium">
          {t("paymentSelector.payFully")}
          {memberDiscountPercent > 0 ? ` (${memberDiscountPercent}% off)` : ""}
        </span>
        {!eligibleForFullBb && (
          <span className="text-xs text-muted-foreground text-center">
            Membership + balance for discounted total
          </span>
        )}
        {eligibleForFullBb && tipCents > 0 && (
          <span className="text-xs text-muted-foreground text-center">
            Remove tip to use this option
          </span>
        )}
      </button>
    </div>
  );
}
