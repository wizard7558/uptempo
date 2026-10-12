"use client";

import { useT } from "@/lib/terms/client";
import Link from "next/link";
import { StoredValueTopUp } from "@/components/booking-public/stored-value-top-up";
import { CardManagement } from "@/components/booking-public/card-management";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StoredValueInitial } from "@/components/booking-public/account-hub";
import { format } from "date-fns";

interface Props {
  clientId: string;
  initialData: StoredValueInitial | null;
  /** When set and client has no active membership, show CTA to self-serve subscribe */
  subscribeHref?: string;
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StoredValueSection({
  clientId,
  initialData,
  subscribeHref,
}: Props) {
  const t = useT("booking");
  const showSubscribeCta =
    Boolean(subscribeHref) && !initialData?.membership;

  return (
    <div className="space-y-6">
      {showSubscribeCta && subscribeHref && (
        <div className="space-y-3 border border-dashed border-[var(--line)] bg-[var(--ivory-raised)] p-4">
          <div>
            <h3 className="eyebrow">{t("storedValueSection.title")}</h3>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              {t("storedValueSection.body")}
            </p>
          </div>
          <Button
            asChild
            className="w-full sm:w-auto"
            variant="default"
            
          >
            <Link href={subscribeHref}>Start subscription</Link>
          </Button>
        </div>
      )}

      {initialData?.membership && (
        <div className="space-y-2 border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-2xl font-light text-[var(--ink)]">Membership</h3>
            <Badge variant="default">Active</Badge>
          </div>
          <p className="text-sm font-medium text-[var(--ink)]">{initialData.membership.planName}</p>
          <p className="text-sm text-[var(--ink-soft)]">
            {formatMoney(initialData.membership.monthlyAmountCents)} / month
          </p>
          {initialData.membership.currentPeriodEnd && (
            <p className="text-xs text-[var(--ink-soft)]">
              Next billing:{" "}
              {format(
                new Date(initialData.membership.currentPeriodEnd),
                "MMM d, yyyy",
              )}
            </p>
          )}
        </div>
      )}

      <StoredValueTopUp clientId={clientId} />

      <div>
        <h3 className="eyebrow mb-2">Saved card</h3>
        <CardManagement clientId={clientId} />
      </div>

      {initialData && initialData.transactions.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">Recent activity</h3>
          <ul className="divide-y border border-[var(--line)] text-sm">
            {initialData.transactions.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"
              >
                <div>
                  <span className="capitalize text-[var(--ink-soft)]">
                    {t.type.replace(/_/g, " ")}
                  </span>
                  {t.note && (
                    <span className="block text-xs text-[var(--ink-soft)]">
                      {t.note}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className={
                      t.amountCents >= 0 ? "text-green-600" : "text-destructive"
                    }
                  >
                    {t.amountCents >= 0 ? "+" : ""}
                    {formatMoney(t.amountCents)}
                  </span>
                  <span className="block text-xs text-[var(--ink-soft)]">
                    Balance {formatMoney(t.runningBalanceCents)}
                  </span>
                  <span className="block text-xs text-[var(--ink-soft)]">
                    {format(new Date(t.createdAt), "MMM d, h:mm a")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
