import React from "react";
import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailFine, emailHeading, emailMuted, type EmailT } from "./components/score";

interface IntakeRequestEmailProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  intakeUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function IntakeRequestEmail({
  t,
  salonName,
  clientName,
  intakeUrl,
  logoUrl,
  brandColor,
}: IntakeRequestEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("intakeMail.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("intakeMail.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("intakeMail.body", { business: salonName })}</Text>
      <Section style={emailCenter}>
        <Button href={intakeUrl} style={emailButtonStyle(brandColor)}>
          {t("intakeMail.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("intakeMail.expires")}</Text>
    </EmailLayout>
  );
}
