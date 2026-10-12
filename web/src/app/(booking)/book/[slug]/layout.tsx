import type { Metadata } from "next";
import { getT } from "@/lib/terms/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getT("booking", slug);
  return {
    title: "Book online",
    description: t("bookLayout.description"),
  };
}

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--ivory)]">
      <div className="mx-auto max-w-lg border-x border-[var(--line)] px-4 py-8 sm:px-6 md:max-w-xl md:py-10 lg:max-w-2xl xl:max-w-3xl">
        {children}
      </div>
    </div>
  );
}
