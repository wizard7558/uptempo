"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BASE_CENTS,
  EXTRA_STAFF_CENTS,
  MAX_EXTRA_STAFF,
  PER_TEXT_CENTS,
  TEXT_LINE_CENTS,
  TEXT_SETUP_CENTS,
  extraStaffQuantity,
  hostedMonthlyCents,
} from "@/lib/billing/hosted-pricing";
import { formatDollars } from "@/lib/marketing/format";

const MIN_STAFF = 1;
const MAX_STAFF = 10;
const MAX_TEXTS = 100_000;

export function PricingCalculator() {
  const t = useTranslations("marketing.pricing.calculator");
  const id = useId();
  const [staff, setStaff] = useState(MIN_STAFF);
  const [textLine, setTextLine] = useState(false);
  const [textsInput, setTextsInput] = useState("100");

  const parsed = Number.parseInt(textsInput, 10);
  const texts = Number.isFinite(parsed) ? Math.min(MAX_TEXTS, Math.max(0, parsed)) : 0;
  const total = hostedMonthlyCents({ staff, textLine, texts });
  const staffCents = BASE_CENTS + extraStaffQuantity(staff) * EXTRA_STAFF_CENTS;
  const textsCents = total - staffCents;
  const staffLabel = `${id}-staff`;

  return (
    <section aria-labelledby={`${id}-title`} className="border border-border p-6 md:p-8">
      <h2 id={`${id}-title`} className="display text-3xl text-foreground">
        {t("title")}
      </h2>

      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <div className="space-y-8">
          <div className="space-y-3">
            <p id={staffLabel} className="text-base font-medium text-foreground">
              {t("staff")}
            </p>
            <div className="flex items-center gap-4" role="group" aria-labelledby={staffLabel}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("fewer")}
                disabled={staff <= MIN_STAFF}
                onClick={() => setStaff((value) => Math.max(MIN_STAFF, value - 1))}
              >
                <MinusIcon aria-hidden />
              </Button>
              <output aria-live="polite" className="min-w-8 text-center text-2xl font-medium tabular-nums">
                {staff}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("more")}
                disabled={staff >= MAX_STAFF}
                onClick={() => setStaff((value) => Math.min(MAX_STAFF, value + 1))}
              >
                <PlusIcon aria-hidden />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t("cap", { count: MAX_EXTRA_STAFF + 1 })}</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`${id}-texts`} className="text-base font-medium text-foreground">
                {t("texts")}
              </Label>
              <Switch id={`${id}-texts`} checked={textLine} onCheckedChange={setTextLine} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("textsHint", {
                line: formatDollars(TEXT_LINE_CENTS),
                each: `${PER_TEXT_CENTS}¢`,
                setup: formatDollars(TEXT_SETUP_CENTS),
              })}
            </p>
            {textLine ? (
              <div className="space-y-2">
                <Label htmlFor={`${id}-count`}>{t("textCount")}</Label>
                <Input
                  id={`${id}-count`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_TEXTS}
                  step={10}
                  value={textsInput}
                  onChange={(event) => setTextsInput(event.target.value)}
                  className="max-w-40"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-6 border-t border-border pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          <div>
            <p className="text-base text-muted-foreground">{t("total")}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <output
                aria-live="polite"
                data-testid="pricing-total"
                className="display text-6xl tabular-nums text-foreground"
              >
                {formatDollars(total)}
              </output>
              <span className="text-base text-muted-foreground">{t("perMonth")}</span>
            </p>
          </div>
          <dl className="space-y-2 text-base">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("staffLine", { count: staff })}</dt>
              <dd className="tabular-nums text-foreground">{formatDollars(staffCents)}</dd>
            </div>
            {textLine ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("textsLine")}</dt>
                <dd className="tabular-nums text-foreground">{formatDollars(textsCents)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="space-y-1 border-t border-border pt-6">
            <p className="text-base font-medium text-foreground">{t("cardTitle")}</p>
            <p className="text-base text-muted-foreground">{t("cardExample")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
