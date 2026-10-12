import React from "react";
import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import {
  EMAIL_FONT_BODY,
  EMAIL_FONT_DISPLAY,
  EMAIL_INK,
  EMAIL_MUTED,
  emailBox,
  emailButtonStyle,
  emailCenter,
  emailFine,
  emailHeading,
  emailMuted,
  type EmailT,
} from "./components/score";

interface FormRequestEmailProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  formName: string;
  formDescription?: string | null;
  formUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function FormRequestEmail({
  t,
  salonName,
  clientName,
  formName,
  formDescription,
  formUrl,
  logoUrl,
  brandColor,
}: FormRequestEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("form.preview", { form: formName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("form.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("form.body")}</Text>
      <Section style={emailBox}>
        <Text style={formNameStyle}>{formName}</Text>
        {formDescription ? <Text style={formDescStyle}>{formDescription}</Text> : null}
      </Section>
      <Section style={emailCenter}>
        <Button href={formUrl} style={emailButtonStyle(brandColor)}>
          {t("form.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("form.expires")}</Text>
    </EmailLayout>
  );
}

const formNameStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "22px",
  fontWeight: "500" as const,
  lineHeight: "28px",
  color: EMAIL_INK,
  margin: "0 0 4px 0",
};

const formDescStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "14px",
  lineHeight: "20px",
  color: EMAIL_MUTED,
  margin: "0",
};
