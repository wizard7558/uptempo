import { Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { BookingDetails } from "./components/booking-details";
import { ActionButtons } from "./components/action-buttons";
import { emailHeading, emailMuted, type EmailT } from "./components/score";

interface BookingReminderProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  staffName: string;
  services: string[];
  date: string;
  time: string;
  duration: string;
  businessAddress?: string | null;
  cancelUrl: string;
  rescheduleUrl: string;
  customGreeting?: string | null;
  customBody?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function BookingReminder({
  t,
  salonName,
  clientName,
  staffName,
  services,
  date,
  time,
  duration,
  businessAddress,
  cancelUrl,
  rescheduleUrl,
  customGreeting,
  customBody,
  logoUrl,
  brandColor,
}: BookingReminderProps) {
  const greeting = customGreeting?.trim()
    ? customGreeting
    : t("reminder.greeting", { name: clientName });
  const body = customBody?.trim() ? customBody : t("reminder.body");

  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("reminder.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{greeting}</Text>
      <Text style={emailMuted}>{body}</Text>
      <BookingDetails
        t={t}
        staffName={staffName}
        services={services}
        date={date}
        time={time}
        duration={duration}
        businessAddress={businessAddress}
      />
      <ActionButtons
        cancelUrl={cancelUrl}
        rescheduleUrl={rescheduleUrl}
        t={t}
        brandColor={brandColor}
      />
    </EmailLayout>
  );
}
