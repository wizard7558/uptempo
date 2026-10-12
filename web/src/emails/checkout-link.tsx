import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { BookingDetails } from "./components/booking-details";
import { emailButtonStyle, emailCenter, emailFine, emailHeading, emailMuted, type EmailT } from "./components/score";

interface CheckoutLinkEmailProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  staffName: string;
  services: string[];
  date: string;
  time: string;
  checkoutUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function CheckoutLinkEmail({
  t,
  salonName,
  clientName,
  staffName,
  services,
  date,
  time,
  checkoutUrl,
  logoUrl,
  brandColor,
}: CheckoutLinkEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("checkout.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("checkout.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("checkout.body", { staffName })}</Text>
      <BookingDetails t={t} staffName={staffName} services={services} date={date} time={time} />
      <Section style={emailCenter}>
        <Button href={checkoutUrl} style={emailButtonStyle(brandColor)}>
          {t("checkout.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("checkout.expires")}</Text>
    </EmailLayout>
  );
}
