import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { SourceLink } from "@/components/layout/source-link";
import { industrySlug, marketingIndustries } from "@/lib/marketing/industries";

const FOOTER_LINK =
  "inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground";

export async function MarketingFooter() {
  const [t, nav] = await Promise.all([
    getTranslations("marketing.footer"),
    getTranslations("marketing.nav"),
  ]);
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <Image src="/brand/wordmark.svg" alt="Uptempo" width={127} height={24} />
            <p className="max-w-xs text-sm text-muted-foreground">{t("tagline")}</p>
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("product")}</h2>
            <ul className="mt-2">
              <li>
                <Link href="/pricing" className={FOOTER_LINK}>
                  {nav("pricing")}
                </Link>
              </li>
              <li>
                <Link href="/open-source" className={FOOTER_LINK}>
                  {nav("openSource")}
                </Link>
              </li>
              <li>
                <Link href="/docs" className={FOOTER_LINK}>
                  {nav("docs")}
                </Link>
              </li>
              <li>
                <Link href="/signup" className={FOOTER_LINK}>
                  {nav("start")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("industries")}</h2>
            <ul className="mt-2">
              {marketingIndustries().map((industry) => (
                <li key={industry.id}>
                  <Link href={`/for/${industrySlug(industry.id)}`} className={FOOTER_LINK}>
                    {industry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("legal")}</h2>
            <ul className="mt-2">
              <li>
                <Link href="/privacy" className={FOOTER_LINK}>
                  {t("privacy")}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={FOOTER_LINK}>
                  {t("terms")}
                </Link>
              </li>
              <li>
                <Link href="/login" className={FOOTER_LINK}>
                  {nav("signIn")}
                </Link>
              </li>
              <li>
                <SourceLink className={FOOTER_LINK} />
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
