import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Clock,
  Users,
  Calendar,
  Shield,
  ArrowRight,
} from "lucide-react";

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1600948836101-f9ffda59d250?auto=format&fit=crop&q=80&w=1200";

const FEATURES = [
  {
    icon: Clock,
    title: "Per-Client Duration Overrides",
    description:
      "Every client gets the right appointment length based on their hair type, history, and service needs. No more guessing.",
  },
  {
    icon: Calendar,
    title: "24/7 Online Booking",
    description:
      "Clients book from their phone anytime. You set your availability, Uptempo handles the rest.",
  },
  {
    icon: Shield,
    title: "Zero Scheduling Errors",
    description:
      "Automatic conflict detection, calendar sync, and buffer management mean no double-bookings, ever.",
  },
  {
    icon: Users,
    title: "Team Management",
    description:
      "Invite stylists, assign roles, and manage your whole team from one dashboard.",
  },
];

const VALUE_PROPS = [
  "Per-client appointment durations",
  "Online booking page for your salon",
  "Calendar sync with Google & Outlook",
  "Client profiles with service history",
  "Forms, waivers & aftercare auto-send",
  "Checkout with card & cash payments",
];

const STATS = [
  {
    value: "30",
    unit: "min",
    label: "Saved daily",
    context: "Admin time per stylist, on average.",
  },
  {
    value: "0",
    unit: "",
    label: "Double bookings",
    context: "Conflict detection on every slot.",
  },
  {
    value: "24",
    unit: "/7",
    label: "Online booking",
    context: "Clients book whenever inspiration strikes.",
  },
  {
    value: "5",
    unit: "min",
    label: "To launch",
    context: "Onboarding, calendar sync, and go.",
  },
];

export default function LandingPage() {
  return (
    <div className="bg-[var(--ivory)]">
      <section className="relative overflow-hidden border-b border-[var(--line)] px-6 pb-24 pt-14 md:pt-20">
        <div className="mx-auto grid max-w-[1500px] items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="space-y-10 lg:col-span-6">
            <div className="inline-flex items-center gap-4 animate-fade-up">
              <span className="eyebrow-rule" />
              <span className="eyebrow">The art of scheduling</span>
            </div>
            <h1 className="display animate-fade-up delay-100 text-5xl leading-[1.04] text-[var(--ink)] md:text-6xl lg:text-[6rem]">
              A schedule as
              <br />
              <span className="inline-block italic text-[#6f7f1d]">
                unique
              </span>
              <br />
              as your clients.
            </h1>
            <p className="animate-fade-up delay-200 max-w-md text-xl font-light leading-relaxed text-[var(--ink-soft)]">
              Uptempo is the all-in-one platform to run your salon. Take 24/7
              online bookings, schedule with per-client appointment lengths,
              keep client records, check out with card or cash, sell
              memberships, and track revenue — synced to your calendar, all in
              one place.
            </p>

            <div className="animate-fade-up delay-300 flex flex-wrap items-center gap-8">
              <Button asChild variant="default" >
                <Link href="/signup">
                  Begin journey
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover/button:translate-x-1.5" />
                </Link>
              </Button>
              <Button asChild variant="ghost" >
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>

            <p className="text-xs tracking-[0.16em] uppercase text-[var(--ink-soft)]">
              No credit card required. Set up in under 5 minutes.
            </p>
            <p className="max-w-xl text-sm text-[var(--ink-soft)]">
              By using Uptempo you agree to our{" "}
              <Link href="/terms" className="editorial-link text-xs">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="editorial-link text-xs">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <div className="relative lg:col-span-6 lg:pl-6">
            <div className="relative aspect-[4/5] w-full overflow-hidden border border-[var(--line)] bg-[var(--ivory-raised)] animate-fade-up delay-200">
              <Image
                src={HERO_IMAGE}
                alt="Warm salon interior"
                fill
                className="object-cover transition-transform duration-[2400ms] ease-out hover:scale-105"
                sizes="(max-width: 1024px) 100vw, 48vw"
                priority
              />
              <div className="pointer-events-none absolute inset-0 bg-[var(--sand)]/20 mix-blend-multiply" />
            </div>

            <Card
              variant="default"
              className="editorial-card-hover absolute -bottom-10 -left-8 z-10 hidden max-w-xs gap-4 border-[var(--ink)] bg-[var(--ink)] md:flex animate-fade-up delay-500 shadow-xl"
            >
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-[var(--ivory)]/70">Next client</span>
                  <span className="size-1.5 rounded-full bg-[var(--ivory)]/60" />
                </div>
                <h3 className="font-display text-2xl font-light text-[var(--ivory)]">
                  Emma C.
                </h3>
                <p className="text-sm font-light text-[var(--ivory)]/75">
                  Balayage & Cut
                </p>
                <div className="h-px bg-[var(--ivory)]/20" />
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ivory)]/60">
                  +30m custom
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Marquee strip — credits roll under the masthead */}
      <section
        aria-label="What's included"
        className="relative overflow-hidden border-b border-border bg-card py-7"
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-card to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-card to-transparent" />
        <div className="flex w-max animate-marquee items-center gap-14 will-change-transform">
          {[...VALUE_PROPS, ...VALUE_PROPS, ...VALUE_PROPS].map((prop, i) => (
            <span key={i} className="flex items-center gap-14">
              <span className="font-display text-[15px] italic tracking-tight text-foreground/85">
                {prop}
              </span>
              <span
                aria-hidden
                className="font-display text-base italic text-accent"
              >
                ✦
              </span>
            </span>
          ))}
        </div>
      </section>

      {/* Features — numbered editorial spread */}
      <section id="features" className="px-6 py-24 md:py-32">
        <div className="mx-auto max-w-6xl">
          <header className="mb-20 grid items-end gap-8 md:grid-cols-12">
            <div className="space-y-5 md:col-span-7">
              <div className="inline-flex items-center gap-4">
                <span className="eyebrow-rule" />
                <span className="eyebrow">Volume I · The platform</span>
              </div>
              <h2 className="display text-4xl leading-[1.05] text-foreground md:text-6xl">
                The details, attended to
                <br />
                <em className="text-[#6f7f1d]">like your craft.</em>
              </h2>
            </div>
            <p className="text-base font-light leading-relaxed text-muted-foreground md:col-span-4 md:col-start-9">
              Four chapters, each one a quiet promise that the schedule will
              hold while you do the work that matters.
            </p>
          </header>

          <ol className="space-y-0">
            {FEATURES.map((feature, idx) => {
              const numberOnRight = idx % 2 === 1;
              const Icon = feature.icon;
              return (
                <li
                  key={feature.title}
                  className="group grid items-start gap-x-10 gap-y-8 border-t border-border py-14 md:grid-cols-12 md:py-20"
                >
                  <div
                    className={cn(
                      "relative md:col-span-4",
                      numberOnRight
                        ? "md:order-2 md:col-start-9"
                        : "md:order-1 md:col-start-1"
                    )}
                  >
                    <span
                      aria-hidden
                      className="display block select-none text-[8.5rem] italic leading-[0.8] text-accent transition-transform duration-700 ease-out group-hover:translate-x-1 md:text-[10rem]"
                    >
                      0{idx + 1}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-3 text-foreground/70">
                      <Icon className="size-4" strokeWidth={1.4} />
                      <span className="eyebrow">Chapter {idx + 1}</span>
                    </span>
                  </div>

                  <div
                    className={cn(
                      "space-y-5 md:col-span-7",
                      numberOnRight
                        ? "md:order-1 md:col-start-1"
                        : "md:order-2 md:col-start-6"
                    )}
                  >
                    <h3 className="display text-3xl leading-tight text-foreground md:text-[2.75rem]">
                      {feature.title}
                    </h3>
                    <p className="max-w-prose text-base font-light leading-relaxed text-muted-foreground md:text-lg">
                      {feature.description}
                    </p>
                    <div className="flex items-center gap-4 pt-2">
                      <span className="h-px w-10 bg-foreground/40" />
                      <span className="eyebrow text-foreground/60">
                        {String(idx + 1).padStart(2, "0")} / {String(FEATURES.length).padStart(2, "0")}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
            <li className="border-t border-border" aria-hidden />
          </ol>
        </div>
      </section>

      {/* Stats — full-bleed dark spread with oversized italic numerals */}
      <section
        aria-label="By the numbers"
        className="relative overflow-hidden border-y border-foreground bg-foreground px-6 py-24 text-background md:py-32"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.6), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.4), transparent 45%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-16 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-4">
                <span className="inline-block h-px w-12 bg-accent" />
                <span className="eyebrow text-background/70">
                  By the numbers
                </span>
              </div>
              <h2 className="display max-w-xl text-4xl leading-[1.05] md:text-5xl">
                Small math.
                <br />
                <em>Large hours back.</em>
              </h2>
            </div>
            <p className="max-w-sm text-sm font-light leading-relaxed text-background/65">
              Across hundreds of salon weeks, the numbers settle into a pattern.
              The chair fills. The mistakes don&apos;t.
            </p>
          </div>

          <dl className="grid gap-12 md:grid-cols-4">
            {STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={cn(
                  "relative pt-8 md:pt-0",
                  i > 0 && "md:border-l md:border-background/15 md:pl-8",
                  i > 0 &&
                    "border-t border-background/15 md:border-t-0"
                )}
              >
                <dd className="flex items-baseline gap-1 text-background">
                  <span className="display text-7xl italic leading-none md:text-[7rem]">
                    {stat.value}
                  </span>
                  {stat.unit && (
                    <span className="display text-2xl italic text-background/60 md:text-3xl">
                      {stat.unit}
                    </span>
                  )}
                </dd>
                <dt className="mt-5 space-y-2">
                  <span className="block text-xs font-medium uppercase tracking-[0.28em] text-background">
                    {stat.label}
                  </span>
                  <span className="block text-xs font-light leading-relaxed text-background/55">
                    {stat.context}
                  </span>
                </dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing colophon — the signature page */}
      <section className="relative border-t border-border bg-card px-6 py-28 md:py-36">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-10 inline-flex items-center gap-4">
            <span className="inline-block h-px w-12 bg-accent" />
            <span className="eyebrow">Begin</span>
            <span className="inline-block h-px w-12 bg-accent" />
          </div>
          <h2 className="display text-4xl leading-[1.05] text-foreground md:text-[4.5rem]">
            Stop guessing
            <br />
            <em className="text-[#6f7f1d]">appointment times.</em>
          </h2>
          <p className="mx-auto mt-8 max-w-lg text-base font-light leading-relaxed text-muted-foreground md:text-lg">
            Join the salons that trust Uptempo to get every booking right.
            Setup takes minutes, not days.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            <Button asChild variant="default" >
              <Link href="/signup">
                Create your salon
                <ArrowRight className="size-4 transition-transform duration-300 group-hover/button:translate-x-1.5" />
              </Link>
            </Button>
            <Link
              href="/pricing"
              className="editorial-link"
            >
              See pricing
            </Link>
          </div>

          <p className="mx-auto mt-10 max-w-md text-sm font-light leading-relaxed text-muted-foreground">
            Not ready yet?{" "}
            <Link href="/waitlist" className="editorial-link">
              Join the waitlist
            </Link>{" "}
            and we&apos;ll reach out when your spot opens up.
          </p>

          <p className="mt-16 flex items-center justify-center gap-4 text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            <span aria-hidden>—</span>
            <span>No credit card · 5 min setup · Cancel anytime</span>
            <span aria-hidden>—</span>
          </p>
        </div>
      </section>
    </div>
  );
}
