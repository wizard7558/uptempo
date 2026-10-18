"use client";

import { useRouter } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en.json";
import { TimeStep } from "@/components/booking-public/time-step";
import { TermsProvider } from "@/lib/terms/client";
import type { DemoIndustry, SampleSchedule } from "@/lib/marketing/sample-schedule";
import type { VerticalTerms } from "@/lib/verticals";

const { booking, requests, waitlist } = messages;

/**
 * The calendar and times of the booking demo. It is split from the demo's
 * frame so the picker's code (calendar, date library, booking actions) loads
 * after the first paint instead of ahead of it. It brings its own strings (the
 * three namespaces the picker reads) so the page's HTML carries no catalog.
 */
export default function BookingDemoStep({
  industry,
  terms,
  schedule,
}: {
  industry: DemoIndustry;
  terms: VerticalTerms;
  schedule: SampleSchedule;
}) {
  const router = useRouter();
  return (
    <NextIntlClientProvider locale="en" messages={{ booking, requests, waitlist }}>
    <TermsProvider terms={terms}>
      <TimeStep
        staffId="any"
        locationId="demo"
        needsAddress={false}
        serviceIds={["demo"]}
        salonTimezone="UTC"
        selectedDate={null}
        selectedTime={null}
        sampleSchedule={schedule}
        onComplete={() => router.push(`/signup?industry=${industry}`)}
      />
    </TermsProvider>
    </NextIntlClientProvider>
  );
}
