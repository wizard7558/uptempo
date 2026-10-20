"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { DemoIndustry, SampleSchedule } from "@/lib/marketing/sample-schedule";
import type { VerticalTerms } from "@/lib/verticals";
import { cn } from "@/lib/utils";

export type BookingDemoOption = {
  id: DemoIndustry;
  label: string;
  /** Already formatted, e.g. "Skin fade, 45 min, $40". */
  service: string;
  /** The sample business, e.g. "Corner Barbers". */
  business: string;
  /** The heading over the picker, e.g. "Book a fade". */
  heading: string;
  terms: VerticalTerms;
  schedule: SampleSchedule;
};

// Reserve the picker's height so it does not push the page when it arrives.
function PickerPlaceholder() {
  return <div aria-hidden className="min-h-[28rem] border border-border bg-muted/40" />;
}

// Client-only on purpose: the picker's chunk is requested once the page is
// idle, after the headline and the first paint, not with the first scripts.
const BookingDemoStep = dynamic(() => import("./booking-demo-step"), {
  ssr: false,
  loading: PickerPlaceholder,
});

/** Mounts the picker once the browser is idle, or at once if it never reports idle. */
function useWhenIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setIdle(true), { timeout: 1500 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => setIdle(true), 200);
    return () => window.clearTimeout(handle);
  }, []);
  return idle;
}

/**
 * A working copy of booking step 2 with fixed sample times. It never calls the
 * server; Continue opens signup for the shown industry.
 */
export function BookingDemo({
  options,
  switcherLabel,
  note,
}: {
  options: BookingDemoOption[];
  switcherLabel: string;
  note: string;
}) {
  // Text arrives as props from the server so this component needs no
  // translation provider, and its pages ship no message catalog.
  const idle = useWhenIdle();
  const [activeId, setActiveId] = useState(options[0].id);
  // Fade the content in only when the visitor switches industry. Animating the
  // first paint would show half-transparent text on load.
  const [switched, setSwitched] = useState(false);
  const active = options.find((option) => option.id === activeId) ?? options[0];

  return (
    <section
      aria-labelledby="booking-demo-heading"
      className="border border-border bg-background p-5 sm:p-6"
      data-booking-demo
    >
      {options.length > 1 ? (
        <div role="group" aria-label={switcherLabel} className="mb-6 grid grid-cols-3 gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === active.id}
              onClick={() => {
                setActiveId(option.id);
                setSwitched(true);
              }}
              className={cn(
                "min-h-11 border border-[var(--input)] px-2 py-2 text-sm font-medium leading-tight transition-colors duration-150",
                option.id === active.id
                  ? "border-foreground bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        key={active.id}
        className={cn(
          "space-y-6",
          switched && "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        )}
      >
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{active.business}</p>
          <h2 id="booking-demo-heading" className="display text-3xl text-foreground">
            {active.heading}
          </h2>
          <p className="text-base text-foreground">{active.service}</p>
        </div>
        <div className="[&_h2]:text-xl">
          {idle ? (
            <BookingDemoStep industry={active.id} terms={active.terms} schedule={active.schedule} />
          ) : (
            <PickerPlaceholder />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
    </section>
  );
}
