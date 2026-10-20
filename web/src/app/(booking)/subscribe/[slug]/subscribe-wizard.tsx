"use client";

import { useT } from "@/lib/terms/client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { IdentityStep } from "@/components/booking-public/details-step";
import { Button } from "@/components/ui/button";
import { PlanStep, type SubscribePlanRow } from "./plan-step";
import { SubscribePaymentStep } from "./subscribe-payment-step";
import {
  CheckCircle2Icon,
  WalletIcon,
  CalendarClockIcon,
  ShoppingBagIcon,
  ConciergeBellIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

type Step = "identity" | "plan" | "card" | "success";

const MEMBERSHIP_BENEFITS: {
  icon: LucideIcon;
  /** Message key under `booking.subscribeWizard` when the title follows industry terms. */
  titleKey?: string;
  title?: string;
  description: string;
}[] = [
  {
    icon: WalletIcon,
    titleKey: "benefitBankTitle",
    description:
      "Choose your monthly contribution. Every dollar is applied toward future services and transformations.",
  },
  {
    icon: CalendarClockIcon,
    title: "Priority Booking",
    description:
      "Enjoy first access to appointments, schedule openings, and preferred reservation windows.",
  },
  {
    icon: ShoppingBagIcon,
    title: "Retail Privileges",
    description:
      "Receive 20% savings on professional home care products selected for your hair.",
  },
  {
    icon: ConciergeBellIcon,
    title: "Concierge Support",
    description:
      "Receive personalized recommendations for appointments, maintenance schedules, and home care.",
  },
  {
    icon: SparklesIcon,
    title: "Personalized Hair Plan",
    description:
      "Work toward your long-term hair goals with a customized maintenance and investment plan.",
  },
];

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

interface SubscribeWizardProps {
  businessId: string;
  businessName: string;
  tenantSlug: string;
  plans: SubscribePlanRow[];
  clientSession: { clientId: string; clientName: string } | null;
  existingMembershipStatus: string | null;
  resumePlanId: string | null;
}

export function SubscribeWizard({
  businessId,
  businessName,
  tenantSlug,
  plans,
  clientSession: initialSession,
  existingMembershipStatus,
  resumePlanId,
}: SubscribeWizardProps) {
  const t = useT("booking");
  const [clientSession, setClientSession] = useState(initialSession);

  const defaultPlanId = useMemo(
    () => (plans.length === 1 ? plans[0]!.id : null),
    [plans],
  );
  const initialPlanId = resumePlanId ?? defaultPlanId;

  // We need the plan step whenever there's a choice to make: multiple plans,
  // OR a single plan that lets the client pick their own contribution amount.
  const needsPlanStep = useMemo(
    () => plans.length > 1 || plans.some((p) => p.allowCustomAmount === 1),
    [plans],
  );

  const [step, setStep] = useState<Step>(() => {
    if (existingMembershipStatus) return "identity";
    if (!initialSession) return "identity";
    if (resumePlanId) return "card"; // returning from the SetupIntent redirect
    if (!needsPlanStep) return "card";
    return "plan";
  });

  const [planId, setPlanId] = useState<string | null>(initialPlanId);
  const [customAmountCents, setCustomAmountCents] = useState<number | null>(
    null,
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === (planId ?? "")) ?? null,
    [plans, planId],
  );

  const onIdentityComplete = useCallback(
    (clientId: string, _clientName: string) => {
      setClientSession({ clientId, clientName: _clientName });
      if (!needsPlanStep) {
        setPlanId(defaultPlanId);
        setStep("card");
      } else {
        setStep("plan");
      }
    },
    [needsPlanStep, defaultPlanId],
  );

  const onPlanContinue = useCallback((id: string, amount: number | null) => {
    setPlanId(id);
    setCustomAmountCents(amount);
    setStep("card");
  }, []);

  const onPaymentSuccess = useCallback(() => {
    setStep("success");
  }, []);

  if (existingMembershipStatus) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 space-y-4">
        <h1 className="display text-4xl text-[var(--ink)]">
          {existingMembershipStatus === "active"
            ? "You're already subscribed"
            : "Your subscription is already in progress"}
        </h1>
        <p className="text-sm text-[var(--ink-soft)]">
          {existingMembershipStatus === "active"
            ? t("subscribeWizard.alreadyActive")
            : t("subscribeWizard.alreadyPending")}
        </p>
        <Button asChild className="w-full" variant="default" >
          <Link href="/account">Go to my account</Link>
        </Button>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 space-y-4">
        <h1 className="display text-4xl text-[var(--ink)]">{t("subscribeWizard.title")}</h1>
        <p className="text-sm text-[var(--ink-soft)]">
          {businessName} doesn&apos;t have any membership plans available online yet.
        </p>
        <Button asChild variant="outline"  className="w-full">
          <Link href={`/book/${tenantSlug}`}>Book an appointment</Link>
        </Button>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="mx-auto max-w-md px-4 py-10 space-y-6 text-center">
        <CheckCircle2Icon className="mx-auto size-14 text-[var(--ink-soft)]" />
        <div>
          <h1 className="display text-4xl text-[var(--ink)]">You&apos;re in</h1>
          <p className="text-sm text-[var(--ink-soft)] mt-2">
            {t("subscribeWizard.successBody")}
          </p>
        </div>
        <Button asChild className="w-full"  variant="default">
          <Link href="/account">View my account</Link>
        </Button>
      </div>
    );
  }

  // Focused checkout flow once the visitor has started joining.
  if (step === "plan" || step === "card") {
    return (
      <div className="mx-auto max-w-md px-4 py-8 space-y-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--ink-soft)]">
            {businessName}
          </p>
          <h1 className="display mt-1 text-4xl text-[var(--ink)]">
            {t("subscribeWizard.membershipTitle")}
          </h1>
          {clientSession && (
            <p className="text-sm text-[var(--ink-soft)] mt-1">
              Signed in as {clientSession.clientName}
            </p>
          )}
        </div>

        {step === "plan" && clientSession && needsPlanStep && (
          <PlanStep
            plans={plans}
            businessName={businessName}
            initialPlanId={planId}
            onContinue={onPlanContinue}
          />
        )}

        {step === "card" && clientSession && planId && selectedPlan && (
          <SubscribePaymentStep
            clientId={clientSession.clientId}
            planId={planId}
            planName={selectedPlan.name}
            monthlyAmountCents={customAmountCents ?? selectedPlan.monthlyAmountCents}
            customAmountCents={customAmountCents}
            onSuccess={onPaymentSuccess}
            onBack={() => {
              if (needsPlanStep) {
                setStep("plan");
              } else {
                setStep("identity");
                setClientSession(null);
              }
            }}
          />
        )}
      </div>
    );
  }

  // Landing / marketing view — the shareable membership page.
  const lowestPlan = plans.reduce(
    (min, p) => (p.monthlyAmountCents < min.monthlyAmountCents ? p : min),
    plans[0],
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14 space-y-16">
      {/* Hero */}
      <section className="text-center space-y-5">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-[var(--ink-soft)]">
          {businessName} · Membership
        </p>
        <h1 className="display text-4xl leading-tight text-[var(--ink)] sm:text-5xl">
          {t("subscribeWizard.membershipTitle")}
        </h1>
        <p className="mx-auto max-w-prose text-[var(--ink-soft)] leading-relaxed">
          Turn every visit into an investment in your hair. Bank monthly credits
          toward future services, unlock member savings, and enjoy priority
          access — all on your terms.
        </p>
        <div className="pt-2">
          <Button asChild variant="default" >
            <a href="#join">Become a member</a>
          </Button>
          {lowestPlan && (
            <p className="mt-3 text-xs text-[var(--ink-soft)]">
              From {formatMoney(lowestPlan.monthlyAmountCents)}/mo · cancel anytime
            </p>
          )}
        </div>
      </section>

      {/* Benefits */}
      <section className="space-y-10">
        <p className="text-center text-xs font-medium uppercase tracking-[0.3em] text-[var(--ink-soft)]">
          Membership benefits
        </p>
        <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {MEMBERSHIP_BENEFITS.map((benefit) => (
            <div
              key={benefit.titleKey ?? benefit.title}
              className="flex flex-col items-center text-center"
            >
              <benefit.icon
                className="size-7 text-[var(--ink-soft)]"
                strokeWidth={1.25}
              />
              <h3 className="mt-4 font-display text-xl font-light leading-tight text-[var(--ink)]">
                {benefit.titleKey ? t(`subscribeWizard.${benefit.titleKey}`) : benefit.title}
              </h3>
              <span className="my-3 block h-px w-8 bg-[var(--line)]" />
              <p className="max-w-[30ch] text-sm leading-relaxed text-[var(--ink-soft)]">
                {benefit.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      {plans.length > 0 && (
        <section className="space-y-5">
          <p className="text-center text-xs font-medium uppercase tracking-[0.3em] text-[var(--ink-soft)]">
            Choose your monthly contribution
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((p) => (
              <div
                key={p.id}
                className="border border-[var(--line)] p-6 text-center"
              >
                <p className="font-display text-lg font-light text-[var(--ink)]">
                  {p.name}
                </p>
                <p className="mt-2 text-3xl font-semibold text-[var(--ink)]">
                  {formatMoney(p.monthlyAmountCents)}
                  <span className="text-sm font-normal text-[var(--ink-soft)]">
                    /mo
                  </span>
                </p>
                {p.retailDiscountPercent > 0 && (
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">
                    {t("subscribeWizard.planDiscount", { percent: p.retailDiscountPercent })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Join */}
      <section id="join" className="mx-auto max-w-md scroll-mt-8 space-y-6">
        <div className="text-center">
          <h2 className="display text-3xl text-[var(--ink)]">
            Start your membership
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Sign in with your phone to begin — it only takes a minute.
          </p>
        </div>
        <IdentityStep businessId={businessId} onComplete={onIdentityComplete} />
      </section>
    </div>
  );
}
