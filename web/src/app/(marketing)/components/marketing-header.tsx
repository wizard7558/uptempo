import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

const NAV_LINK =
  "min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground";

export async function MarketingHeader() {
  const t = await getTranslations("marketing.nav");
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="inline-flex min-h-11 items-center" aria-label={t("home")}>
          <Image src="/brand/wordmark.svg" alt="" width={127} height={24} priority className="sm:hidden" />
          <Image src="/brand/wordmark.svg" alt="" width={148} height={28} priority className="hidden sm:block" />
        </Link>

        <nav aria-label={t("label")} className="flex items-center gap-5 md:gap-7">
          <Link href="/#industries" className={`${NAV_LINK} hidden md:inline-flex`}>
            {t("industries")}
          </Link>
          <Link href="/pricing" className={`${NAV_LINK} hidden md:inline-flex`}>
            {t("pricing")}
          </Link>
          <Link href="/open-source" className={`${NAV_LINK} hidden md:inline-flex`}>
            {t("openSource")}
          </Link>
          <Link href="/docs" className={`${NAV_LINK} hidden lg:inline-flex`}>
            {t("docs")}
          </Link>
          <Link href="/login" className={`${NAV_LINK} inline-flex`}>
            {t("signIn")}
          </Link>
          <Button asChild>
            <Link href="/signup">{t("start")}</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
