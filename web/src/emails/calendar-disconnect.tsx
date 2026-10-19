import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailFine, emailHeading, emailText, type EmailT } from "./components/score";

interface CalendarDisconnectEmailProps {
  t: EmailT;
  businessName: string;
  staffName: string;
  platformLabel: string;
  settingsUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function CalendarDisconnectEmail({
  t,
  businessName,
  staffName,
  platformLabel,
  settingsUrl,
  logoUrl,
  brandColor,
}: CalendarDisconnectEmailProps) {
  return (
    <EmailLayout
      businessName={businessName}
      previewText={t("calendar.preview", { platform: platformLabel, staffName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("calendar.heading")}</Text>
      <Text style={emailText}>
        {t("calendar.body", { staffName, platform: platformLabel })}
      </Text>
      <Section style={emailCenter}>
        <Button href={settingsUrl} style={emailButtonStyle(brandColor)}>
          {t("calendar.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("calendar.note", { business: businessName })}</Text>
    </EmailLayout>
  );
}
