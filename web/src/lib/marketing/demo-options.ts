import type { BookingDemoOption } from "@/components/marketing/booking-demo";
import { formatDollars, formatDuration } from "@/lib/marketing/format";
import {
  DEMO_INDUSTRIES,
  DEMO_SERVICE_NAMES,
  buildSampleSchedule,
  type DemoIndustry,
} from "@/lib/marketing/sample-schedule";
import { VERTICALS } from "@/lib/verticals";

type MarketingTranslate = (key: string, values?: Record<string, string | number>) => string;

/** Props for `BookingDemo`, built on the server so the client gets no vertical packs. */
export function bookingDemoOptions(
  t: MarketingTranslate,
  now: Date,
  ids: readonly DemoIndustry[] = DEMO_INDUSTRIES,
): BookingDemoOption[] {
  return ids.map((id) => {
    const vertical = VERTICALS[id];
    const service = vertical.serviceTemplates.find((item) => item.name === DEMO_SERVICE_NAMES[id]);
    if (!service) throw new Error(`No ${DEMO_SERVICE_NAMES[id]} template in the ${id} pack`);
    return {
      id,
      label: vertical.label,
      business: t(`demo.business.${id}`),
      heading: t(`demo.heading.${id}`),
      service: t("demo.service", {
        name: service.name,
        duration: formatDuration(t, service.minutes),
        price: formatDollars(service.priceCents),
      }),
      terms: vertical.terms,
      schedule: buildSampleSchedule(id, now),
    };
  });
}
