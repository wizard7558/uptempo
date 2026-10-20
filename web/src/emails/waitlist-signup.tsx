import React from "react";
import { Text, Section, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { PLATFORM_PRODUCT_NAME } from "@/lib/platform-product";
import {
  EMAIL_FONT_BODY,
  EMAIL_FONT_DISPLAY,
  EMAIL_INK,
  EMAIL_LINE,
  EMAIL_MUTED,
  emailHeading,
  emailMuted,
  type EmailT,
} from "./components/score";

export interface WaitlistSignupEmailProps {
  t: EmailT;
  name: string | null;
  email: string;
  phone: string | null;
  source: string | null;
  submittedAt: string;
  businessName?: string;
  logoUrl?: string | null;
}

export function WaitlistSignupEmail({
  t,
  name,
  email,
  phone,
  source,
  submittedAt,
  businessName = PLATFORM_PRODUCT_NAME,
  logoUrl,
}: WaitlistSignupEmailProps) {
  const rows: Array<[string, string | null]> = [
    [t("waitlistSignup.name"), name],
    [t("waitlistSignup.email"), email],
    [t("waitlistSignup.phone"), phone],
    [t("waitlistSignup.source"), source],
  ];
  const filled = rows.filter((row): row is [string, string] => row[1] != null && row[1] !== "");

  return (
    <EmailLayout businessName={businessName} previewText={t("waitlistSignup.preview")} logoUrl={logoUrl} t={t}>
      <Text style={emailHeading}>{t("waitlistSignup.heading")}</Text>
      <Text style={emailMuted}>{t("waitlistSignup.joined", { when: submittedAt })}</Text>
      <Text style={emailMuted}>{t("waitlistSignup.note")}</Text>
      <Hr style={dividerStyle} />
      {filled.map(([label, value]) => (
        <Section key={label} style={rowSection}>
          <Text style={labelStyle}>{label}</Text>
          <Text style={valueStyle}>{value}</Text>
        </Section>
      ))}
    </EmailLayout>
  );
}

const dividerStyle = { borderColor: EMAIL_LINE, margin: "12px 0" };
const rowSection = { margin: "0 0 14px 0" };

const labelStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "13px",
  fontWeight: "500" as const,
  color: EMAIL_MUTED,
  margin: "0 0 2px 0",
};

const valueStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "18px",
  fontWeight: "500" as const,
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};
