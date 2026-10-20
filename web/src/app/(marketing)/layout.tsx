import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PostHogLazy } from "@/lib/analytics/posthog-lazy";
import { MarketingHeader } from "./components/marketing-header";
import { MarketingFooter } from "./components/marketing-footer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");
  return { title: t("title"), description: t("description") };
}

// No translation provider here on purpose. Marketing pages render their text
// on the server; a page with a client component that needs strings wraps just
// that component (see pricing/page.tsx), so the others ship no message catalog.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PostHogLazy />
      <div
        className="light flex min-h-screen flex-col bg-background text-foreground"
        data-theme-scope="marketing"
      >
        <MarketingHeader />
        <main className="flex-1">{children}</main>
        <MarketingFooter />
      </div>
    </>
  );
}
