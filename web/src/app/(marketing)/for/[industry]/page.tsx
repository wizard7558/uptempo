import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BookingDemo } from "@/components/marketing/booking-demo";
import { Button } from "@/components/ui/button";
import { HOSTED_TRIAL_DAYS } from "@/lib/billing/hosted-pricing";
import { bookingDemoOptions } from "@/lib/marketing/demo-options";
import { formatDollars, formatDuration } from "@/lib/marketing/format";
import {
  SCREENSHOT_SIZES,
  bookingScreenshot,
  industryFromSlug,
  industrySlug,
  marketingIndustries,
} from "@/lib/marketing/industries";
import { DEMO_INDUSTRIES, type DemoIndustry } from "@/lib/marketing/sample-schedule";
import { termArgs } from "@/lib/terms/args";

export const dynamicParams = false;
// The home services demo counts its sample dates forward from today.
export const revalidate = 3600;

type Props = { params: Promise<{ industry: string }> };

export function generateStaticParams() {
  return marketingIndustries().map((industry) => ({ industry: industrySlug(industry.id) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const industry = industryFromSlug((await params).industry);
  if (!industry) return {};
  const t = await getTranslations("marketing");
  return {
    title: t("industry.metaTitle", { title: t(`industries.${industry.id}.title`) }),
    description: t(`industries.${industry.id}.lead`),
  };
}

function isDemoIndustry(id: string): id is DemoIndustry {
  return (DEMO_INDUSTRIES as readonly string[]).includes(id);
}

export default async function IndustryPage({ params }: Props) {
  const industry = industryFromSlug((await params).industry);
  if (!industry) notFound();

  const [t, modules] = await Promise.all([
    getTranslations("marketing"),
    getTranslations("modules.items"),
  ]);
  const terms = termArgs(industry.terms);
  const name = t(`industries.${industry.id}.name`);
  const useCases = t.raw(`industries.${industry.id}.useCases`) as string[];
  const screenshot = bookingScreenshot(industry.id);
  const demo = !screenshot && isDemoIndustry(industry.id)
    ? bookingDemoOptions(t, new Date(), [industry.id])
    : null;
  const signup = `/signup?industry=${industry.id}`;

  return (
    <>
      <section className="border-b border-border px-6 pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-8 lg:pt-8">
            <p className="text-base font-medium text-muted-foreground">{industry.label}</p>
            <h1 className="display text-5xl leading-[1.05] text-foreground md:text-6xl">
              {t(`industries.${industry.id}.title`)}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t(`industries.${industry.id}.lead`)}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <Link href={signup}>{t("industry.start", { days: HOSTED_TRIAL_DAYS })}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">{t("industry.pricing")}</Link>
              </Button>
            </div>
          </div>
          {screenshot ? (
            <Image
              src={screenshot}
              alt={t("industry.screenshotAlt", { name })}
              width={SCREENSHOT_SIZES.booking.width}
              height={SCREENSHOT_SIZES.booking.height}
              sizes="(min-width: 1024px) 360px, 90vw"
              priority
              className="mx-auto h-auto w-full max-w-[360px] border border-border"
            />
          ) : demo ? (
            <BookingDemo
              options={demo}
              switcherLabel={t("demo.switcherLabel")}
              note={t("demo.note")}
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="use-cases" className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 id="use-cases" className="display text-4xl text-foreground">
            {t("industry.useCasesTitle", { name })}
          </h2>
          <ul className="mt-10 grid gap-x-10 gap-y-6 md:grid-cols-2">
            {useCases.map((useCase) => (
              <li key={useCase} className="border-t border-border pt-4 text-lg text-foreground">
                {useCase}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="starter-services" className="border-t border-border px-6 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 id="starter-services" className="display text-4xl text-foreground">
              {t("industry.servicesTitle", terms)}
            </h2>
            <p className="text-lg text-muted-foreground">{t("industry.servicesLead")}</p>
          </div>
          <table className="w-full text-left text-base">
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th scope="col" className="py-3 pr-4 font-medium">
                  {t("industry.servicesName", terms)}
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  {t("industry.servicesLength")}
                </th>
                <th scope="col" className="py-3 text-right font-medium">
                  {t("industry.servicesPrice")}
                </th>
              </tr>
            </thead>
            <tbody>
              {industry.serviceTemplates
                .filter((service) => !service.isAddon)
                .map((service) => (
                  <tr key={service.name} className="border-b border-border">
                    <td className="py-3 pr-4 text-foreground">{service.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {formatDuration(t, service.minutes)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-foreground">
                      {service.priceCents === 0 ? t("industry.free") : formatDollars(service.priceCents)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="modules-on" className="border-t border-border px-6 py-16 md:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 id="modules-on" className="display text-4xl text-foreground">
              {t("industry.modulesTitle")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("industry.modulesLead", { name })}</p>
            <h3 className="pt-6 text-lg font-medium text-foreground">{t("industry.wordsTitle")}</h3>
            <p className="text-lg text-muted-foreground">{t("industry.wordsLead", terms)}</p>
          </div>
          <dl className="space-y-6">
            {industry.modules.map((id) => (
              <div key={id} className="border-t border-border pt-4">
                <dt className="text-lg font-medium text-foreground">{modules(`${id}.name`, terms)}</dt>
                <dd className="mt-1 text-base text-muted-foreground">{modules(`${id}.description`, terms)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-labelledby="other-industries" className="border-t border-border px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 id="other-industries" className="text-lg font-medium text-foreground">
            {t("industry.othersTitle")}
          </h2>
          <ul className="mt-4 flex flex-wrap gap-x-8">
            {marketingIndustries()
              .filter((other) => other.id !== industry.id)
              .map((other) => (
                <li key={other.id}>
                  <Link
                    href={`/for/${industrySlug(other.id)}`}
                    className="inline-flex min-h-11 items-center text-base text-accent underline-offset-4 hover:underline"
                  >
                    {other.label}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </section>
    </>
  );
}
