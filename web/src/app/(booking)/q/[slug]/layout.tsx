import type { Metadata } from "next";
import { getT } from "@/lib/terms/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getT("queue", slug);
  return { title: t("meta.title"), robots: { index: false, follow: false } };
}

// Same frame as the booking pages; the (booking) group layout adds branding and the header.
export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--ivory)]">
      <div className="mx-auto max-w-lg border-x border-[var(--line)] px-4 py-8 sm:px-6 md:max-w-xl md:py-10 lg:max-w-2xl xl:max-w-3xl">
        {children}
      </div>
    </div>
  );
}
