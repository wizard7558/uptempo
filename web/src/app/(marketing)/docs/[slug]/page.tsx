import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DOC_SECTIONS, getDocSection } from "@/lib/docs/sections";
import { DocSectionPage } from "../doc-article";

export function generateStaticParams() {
  return DOC_SECTIONS.map((section) => ({ slug: section.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const section = getDocSection(slug);
  return { title: section ? `${section.title} — Uptempo Bookings` : "Docs" };
}

export default async function DocsSectionRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const section = getDocSection(slug);
  if (!section) notFound();
  return <DocSectionPage section={section} />;
}
