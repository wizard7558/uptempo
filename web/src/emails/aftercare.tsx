import React from "react";
import { Text, Section, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import {
  EMAIL_FONT_BODY,
  EMAIL_FONT_DISPLAY,
  EMAIL_INK,
  EMAIL_LINE,
  EMAIL_MUTED,
  emailBox,
  emailHeading,
  emailMuted,
  type EmailT,
} from "./components/score";

interface AftercareEmailProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  templates: Array<{
    name: string;
    content: string;
    productRecommendations: string | null;
  }>;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function AftercareEmail({
  t,
  salonName,
  clientName,
  templates,
  logoUrl,
}: AftercareEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("aftercare.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("aftercare.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("aftercare.body", { business: salonName })}</Text>

      {templates.map((template, index) => (
        <Section key={template.name} style={templateSection}>
          <Text style={templateNameStyle}>{template.name}</Text>
          <Text style={templateContentStyle}>{template.content}</Text>
          {template.productRecommendations ? (
            <Section style={emailBox}>
              <Text style={recommendationsLabelStyle}>{t("aftercare.products")}</Text>
              <Text style={templateContentStyle}>{template.productRecommendations}</Text>
            </Section>
          ) : null}
          {index < templates.length - 1 ? <Hr style={dividerStyle} /> : null}
        </Section>
      ))}
    </EmailLayout>
  );
}

const templateSection = { margin: "0 0 8px 0" };

const templateNameStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "22px",
  fontWeight: "500" as const,
  lineHeight: "28px",
  color: EMAIL_INK,
  margin: "0 0 8px 0",
};

const templateContentStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0 0 12px 0",
  whiteSpace: "pre-wrap" as const,
};

const recommendationsLabelStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "14px",
  fontWeight: "500" as const,
  color: EMAIL_MUTED,
  margin: "0 0 4px 0",
};

const dividerStyle = {
  borderColor: EMAIL_LINE,
  margin: "16px 0",
};
