import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { HOSTED_TRIAL_DAYS } from "@/lib/billing/hosted-pricing";
import { PricingCalculator } from "./pricing-calculator";

export default async function PricingPage() {
  const t = await getTranslations("marketing.pricing");
  // The calculator is the only client component here and reads only its own
  // strings, so only those go into the page.
  const { marketing } = await getMessages();
  const calculatorMessages = { marketing: { pricing: { calculator: marketing.pricing.calculator } } };
  return (
    <div className="px-6 py-12 md:py-20">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="max-w-2xl space-y-4">
          <h1 className="display text-5xl text-foreground md:text-6xl">{t("title")}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{t("lead")}</p>
          <p className="text-base text-foreground">{t("trial", { days: HOSTED_TRIAL_DAYS })}</p>
          <Button asChild size="lg">
            <Link href="/signup">{t("start", { days: HOSTED_TRIAL_DAYS })}</Link>
          </Button>
        </header>

        <NextIntlClientProvider messages={calculatorMessages}>
          <PricingCalculator />
        </NextIntlClientProvider>

        <section aria-labelledby="pricing-open-source" className="max-w-2xl space-y-4">
          <h2 id="pricing-open-source" className="display text-3xl text-foreground">
            {t("openSourceTitle")}
          </h2>
          <p className="text-lg text-muted-foreground">{t("openSourceLead")}</p>
          <Button asChild variant="outline">
            <Link href="/open-source">{t("openSourceLink")}</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
