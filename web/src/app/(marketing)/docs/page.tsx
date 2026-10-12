import type { Metadata } from "next";
import { DOC_SECTIONS } from "@/lib/docs/sections";
import { DocArticle } from "./doc-article";

export const metadata: Metadata = {
  title: "Docs — Uptempo Bookings",
};

export default function DocsPage() {
  return (
    <DocArticle
      eyebrow="Docs"
      title="Uptempo docs"
      paragraphs={[
        "Read the self-host quickstart, the modules a business can turn on, the HTTP API, and how to contribute.",
        ...DOC_SECTIONS.map((section) => `${section.title}: ${section.heading}`),
      ]}
    />
  );
}
