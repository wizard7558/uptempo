"use client";

import { useT } from "@/lib/terms/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getMembershipUpsellInfo } from "@/actions/membership";
import { PiggyBankIcon } from "lucide-react";

interface MembershipUpsellProps {
  businessSlug: string;
  clientId: string;
  /** Visual variant: "card" (standalone, e.g. success screen) or "inline" (compact hint). */
  variant?: "card" | "inline";
}

/**
 * Invites a non-member client to join the salon's Beauty Bank membership (or add
 * funds). Self-gates: fetches eligibility and renders nothing unless the salon has
 * active plans and the client isn't already a member. Safe to mount anywhere in
 * the booking flow — it never throws and shows nothing when not applicable.
 */
export function MembershipUpsell({
  businessSlug,
  clientId,
  variant = "card",
}: MembershipUpsellProps) {
  const t = useT("booking");
  const [show, setShow] = useState(false);
  const [discount, setDiscount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await getMembershipUpsellInfo(clientId);
        if (cancelled) return;
        setShow(info.hasActivePlans && !info.isMember);
        setDiscount(info.topMemberDiscountPercent);
      } catch {
        if (!cancelled) setShow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!show) return null;

  if (variant === "inline") {
    return (
      <p className="text-xs text-[var(--ink-soft)]">
        {discount > 0
          ? t("membershipUpsell.inlineDiscount", { discount })
          : t("membershipUpsell.inlineNoDiscount")}
        <Link href={`/subscribe/${businessSlug}`} className="editorial-link">
          become a member
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3 border border-dashed border-[var(--line)] bg-[var(--ivory-raised)] p-4">
      <div className="flex items-start gap-3">
        <PiggyBankIcon className="mt-0.5 size-5 shrink-0 text-[var(--ink-soft)]" />
        <div>
          <h3 className="eyebrow">{t("membershipUpsell.cardTitle")}</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {discount > 0
              ? t("membershipUpsell.cardDiscount", { discount })
              : t("membershipUpsell.cardNoDiscount")}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="default"  className="w-full sm:w-auto">
          <Link href={`/subscribe/${businessSlug}`}>Become a member</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          
          className="w-full sm:w-auto"
        >
          <Link href="/account">Add funds</Link>
        </Button>
      </div>
    </div>
  );
}
