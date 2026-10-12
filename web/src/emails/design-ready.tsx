import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailHeading, emailText, type EmailT } from "./components/score";

interface DesignReadyEmailProps {
  t: EmailT;
  businessName: string;
  link: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function DesignReadyEmail({ businessName, t, link, logoUrl, brandColor }: DesignReadyEmailProps) {
  return (
    <EmailLayout
      businessName={businessName}
      previewText={t("design.heading")}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("design.heading")}</Text>
      <Text style={emailText}>{t("design.body", { business: businessName })}</Text>
      <Section style={emailCenter}>
        <Button href={link} style={emailButtonStyle(brandColor)}>
          {t("design.cta")}
        </Button>
      </Section>
    </EmailLayout>
  );
}
