import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { sourceUrl } from "@/lib/source-url";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.openSource");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

function cloneDirectory(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last?.replace(/\.git$/, "") || "uptempo";
  } catch {
    return "uptempo";
  }
}

export default async function OpenSourcePage() {
  const t = await getTranslations("marketing.openSource");
  const repo = sourceUrl();
  const snippet = [
    `git clone ${repo}`,
    `cd ${cloneDirectory(repo)}`,
    "./scripts/init-env.sh",
    "docker compose up -d",
  ].join("\n");

  return (
    <div className="px-6 py-12 md:py-20">
      <div className="mx-auto max-w-4xl space-y-16">
        <header className="max-w-2xl space-y-6">
          <h1 className="display text-5xl text-foreground md:text-6xl">{t("title")}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{t("lead")}</p>
          <Button asChild size="lg">
            <a href={repo}>{t("repo")}</a>
          </Button>
        </header>

        <section aria-labelledby="quickstart" className="space-y-4">
          <h2 id="quickstart" className="display text-3xl text-foreground">
            {t("quickstartTitle")}
          </h2>
          <p className="text-lg text-muted-foreground">{t("quickstartLead")}</p>
          <pre
            tabIndex={0}
            aria-label={t("quickstartTitle")}
            className="overflow-x-auto border border-border bg-foreground p-5 font-mono text-sm leading-7 text-background"
          >
            <code>{snippet}</code>
          </pre>
          <p className="text-base text-muted-foreground">{t("quickstartAfter")}</p>
          <Link
            href="/docs/self-hosting"
            className="inline-flex min-h-11 items-center text-base text-accent underline underline-offset-4"
          >
            {t("guide")}
          </Link>
        </section>

        <section aria-labelledby="license" className="space-y-4">
          <h2 id="license" className="display text-3xl text-foreground">
            {t("licenseTitle")}
          </h2>
          <p className="max-w-2xl text-lg text-muted-foreground">{t("licenseBody")}</p>
        </section>

        <section aria-labelledby="compare" className="space-y-6">
          <h2 id="compare" className="display text-3xl text-foreground">
            {t("compareTitle")}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 border border-border p-6">
              <h3 className="text-xl font-medium text-foreground">{t("hostedTitle")}</h3>
              <p className="text-base text-muted-foreground">{t("hostedBody")}</p>
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center text-base text-accent underline underline-offset-4"
              >
                {t("hostedLink")}
              </Link>
            </div>
            <div className="space-y-3 border border-border p-6">
              <h3 className="text-xl font-medium text-foreground">{t("selfTitle")}</h3>
              <p className="text-base text-muted-foreground">{t("selfBody")}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
