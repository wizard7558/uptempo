import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support | Uptempo",
};

export default function SupportPage() {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)]">
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="inline-flex items-center gap-4">
          <span className="eyebrow-rule" />
          <span className="eyebrow">Support</span>
        </div>
        <h1 className="display mt-6 text-4xl leading-tight text-[var(--ink)] md:text-5xl">
          Uptempo Support
        </h1>
        <div className="mt-10 space-y-6 border-t border-[var(--line)] pt-8 text-[var(--ink-soft)] leading-relaxed [&_a]:text-[var(--ink)] [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-[var(--ink-soft)]">
          <p>
            Contact us for help with Uptempo Bookings or Uptempo for Business at{" "}
            <a href="mailto:riley@bellaso.ai">riley@bellaso.ai</a>.
          </p>
          <p>
            Please include the app you are using, your device and iOS version,
            and what happened.
          </p>
          <p>
            For appointment changes, contact the service business directly.
          </p>
        </div>
      </article>
    </div>
  );
}
