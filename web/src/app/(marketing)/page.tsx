import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookingDemo } from "@/components/marketing/booking-demo";
import { Button } from "@/components/ui/button";
import {
  BASE_CENTS,
  EXTRA_STAFF_CENTS,
  HOSTED_TRIAL_DAYS,
  MAX_EXTRA_STAFF,
} from "@/lib/billing/hosted-pricing";
import { bookingDemoOptions } from "@/lib/marketing/demo-options";
import { formatDollars } from "@/lib/marketing/format";
import {
  SCREENSHOT_SIZES,
  bookingScreenshot,
  industrySlug,
  marketingIndustries,
  type MarketingIndustryId,
} from "@/lib/marketing/industries";

// The demo's sample dates count forward from today.
export const revalidate = 3600;

const INCLUDED = ["booking", "calendar", "reminders", "payments", "clients", "reports"] as const;
const BOOKING_SHOTS: MarketingIndustryId[] = ["barber", "nail_salon", "tattoo"];

export default async function LandingPage() {
  const [t, industryCopy] = await Promise.all([
    getTranslations("marketing"),
    getTranslations("marketing.industries"),
  ]);
  const industries = marketingIndustries();
  const demo = bookingDemoOptions(t, new Date());

  return (
    <>
      <section className="border-b border-border px-6 pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-8 lg:pt-8">
            <h1 className="display text-5xl leading-[1.05] text-foreground md:text-6xl">
              {t("home.title")}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{t("home.lead")}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link href="/signup">{t("home.start", { days: HOSTED_TRIAL_DAYS })}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">{t("home.pricing")}</Link>
              </Button>
            </div>
          </div>
          <BookingDemo
            options={demo}
            switcherLabel={t("demo.switcherLabel")}
            note={t("demo.note")}
          />
        </div>
      </section>

      <section id="industries" aria-labelledby="industries-title" className="scroll-mt-16 px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl space-y-4">
            <h2 id="industries-title" className="display text-4xl text-foreground">
              {t("home.industriesTitle")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("home.industriesLead")}</p>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((industry) => (
              <li key={industry.id}>
                <Link
                  href={`/for/${industrySlug(industry.id)}`}
                  className="flex h-full flex-col gap-2 border border-border p-6 transition-colors duration-150 hover:border-foreground"
                >
                  <span className="display text-2xl text-foreground">{industry.label}</span>
                  <span className="text-base text-muted-foreground">{industry.description}</span>
                  <span className="mt-auto pt-2 text-sm font-medium text-accent">
                    {t("home.industryLink", { name: industryCopy(`${industry.id}.name`) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="booking-title" className="border-t border-border px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl space-y-4">
            <h2 id="booking-title" className="display text-4xl text-foreground">
              {t("home.bookingTitle")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("home.bookingLead")}</p>
          </div>
          <ul className="mt-10 grid gap-6 sm:grid-cols-3">
            {BOOKING_SHOTS.map((id) => (
              <li key={id}>
                <Image
                  src={bookingScreenshot(id)!}
                  alt={t("home.bookingAlt", { name: industryCopy(`${id}.name`) })}
                  width={SCREENSHOT_SIZES.booking.width}
                  height={SCREENSHOT_SIZES.booking.height}
                  sizes="(min-width: 640px) 30vw, 100vw"
                  className="h-auto w-full border border-border"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="included-title" className="border-t border-border px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 id="included-title" className="display text-4xl text-foreground">
            {t("home.includedTitle")}
          </h2>
          <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((key) => (
              <div key={key} className="space-y-2 border-t border-border pt-4">
                <dt className="text-lg font-medium text-foreground">{t(`home.included.${key}.title`)}</dt>
                <dd className="text-base text-muted-foreground">{t(`home.included.${key}.body`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-border px-6 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2">
          <div className="space-y-4">
            <h2 className="display text-3xl text-foreground">{t("home.pricingTitle")}</h2>
            <p className="text-lg text-muted-foreground">
              {t("home.pricingLead", {
                base: formatDollars(BASE_CENTS),
                extra: formatDollars(EXTRA_STAFF_CENTS),
                cap: formatDollars(BASE_CENTS + MAX_EXTRA_STAFF * EXTRA_STAFF_CENTS),
              })}
            </p>
            <Button asChild variant="outline">
              <Link href="/pricing">{t("home.pricingLink")}</Link>
            </Button>
          </div>
          <div className="space-y-4">
            <h2 className="display text-3xl text-foreground">{t("home.openSourceTitle")}</h2>
            <p className="text-lg text-muted-foreground">{t("home.openSourceLead")}</p>
            <Button asChild variant="outline">
              <Link href="/open-source">{t("home.openSourceLink")}</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t border-border px-6 py-16 text-center md:py-24">
        <div className="mx-auto max-w-2xl space-y-6">
          <h2 className="display text-4xl text-foreground md:text-5xl">{t("home.closingTitle")}</h2>
          <p className="text-lg text-muted-foreground">{t("home.closingLead")}</p>
          <Button asChild size="lg">
            <Link href="/signup">{t("home.start", { days: HOSTED_TRIAL_DAYS })}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
