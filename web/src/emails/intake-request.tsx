import React from "react";
import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailFine, emailHeading, emailMuted, type EmailT } from "./components/score";

interface IntakeRequestEmailProps {
  t: EmailT;
  businessName: string;
  clientName: string;
  intakeUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function IntakeRequestEmail({
  t,
  businessName,
  clientName,
  intakeUrl,
  logoUrl,
  brandColor,
}: IntakeRequestEmailProps) {
  return (
    <EmailLayout
      businessName={businessName}
      previewText={t("intakeMail.preview", { business: businessName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("intakeMail.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("intakeMail.body", { business: businessName })}</Text>
      <Section style={emailCenter}>
        <Button href={intakeUrl} style={emailButtonStyle(brandColor)}>
          {t("intakeMail.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("intakeMail.expires")}</Text>
    </EmailLayout>
  );
}
