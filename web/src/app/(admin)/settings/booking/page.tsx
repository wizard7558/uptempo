import { getT } from "@/lib/terms/server";
import { getBookingRules } from "@/actions/booking-rules";
import { BookingRulesClient } from "./client";

export default async function BookingRulesPage() {
  const t = await getT("settings");
  const rules = await getBookingRules();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("bookingRules.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("bookingRules.subtitle")}</p>
      </div>
      <BookingRulesClient initialRules={rules} />
    </div>
  );
}
