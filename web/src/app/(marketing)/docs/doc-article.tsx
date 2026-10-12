import Link from "next/link";
import type { DocSection } from "@/lib/docs/sections";
import { DOC_SECTIONS } from "@/lib/docs/sections";

export function DocArticle({
  eyebrow,
  title,
  paragraphs,
}: {
  eyebrow: string;
  title: string;
  paragraphs: string[];
}) {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)]">
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="inline-flex items-center gap-4">
          <span className="eyebrow-rule" />
          <span className="eyebrow">{eyebrow}</span>
        </div>
        <h1 className="display mt-6 text-4xl leading-tight text-[var(--ink)] md:text-5xl">{title}</h1>
        <div className="mt-10 space-y-6 border-t border-[var(--line)] pt-8 text-[var(--ink-soft)] leading-relaxed">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <nav className="mt-12 flex flex-wrap gap-4 text-sm">
          {DOC_SECTIONS.map((section) => (
            <Link key={section.slug} className="underline underline-offset-4" href={`/docs/${section.slug}`}>
              {section.title}
            </Link>
          ))}
          <Link className="underline underline-offset-4" href="/docs/self-hosting">
            docs/self-hosting.md
          </Link>
        </nav>
      </article>
    </div>
  );
}

export function DocSectionPage({ section }: { section: DocSection }) {
  return <DocArticle eyebrow="Docs" title={section.heading} paragraphs={section.paragraphs} />;
}
