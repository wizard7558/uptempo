import React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Hr,
  Img,
  Preview,
  Section,
} from "@react-email/components";
import type { ReactNode } from "react";
import { normalizeLogoUrlForEmail } from "@/lib/email/normalize-logo-url";
import { PLATFORM_PRODUCT_NAME } from "@/lib/platform-product";
import {
  EMAIL_FONT_BODY,
  EMAIL_FONT_DISPLAY,
  EMAIL_INK,
  EMAIL_LINE,
  EMAIL_MUTED,
  EMAIL_PAPER,
  type EmailT,
} from "./score";

interface EmailLayoutProps {
  businessName: string;
  previewText: string;
  logoUrl?: string | null;
  t: EmailT;
  children: ReactNode;
}

export function EmailLayout({
  businessName,
  previewText,
  logoUrl,
  t,
  children,
}: EmailLayoutProps) {
  const resolvedLogoUrl = normalizeLogoUrlForEmail(logoUrl);

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            {resolvedLogoUrl ? (
              <Img src={resolvedLogoUrl} alt={businessName} width={200} style={logoStyle} />
            ) : (
              <Text style={nameStyle}>{businessName}</Text>
            )}
          </Section>

          {children}

          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            {t("layout.footer", { business: businessName, product: PLATFORM_PRODUCT_NAME })}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: EMAIL_PAPER,
  color: EMAIL_INK,
  fontFamily: EMAIL_FONT_BODY,
  margin: "0",
  padding: "0",
};

const containerStyle = {
  backgroundColor: EMAIL_PAPER,
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "600px",
};

const headerStyle = {
  textAlign: "center" as const,
  marginBottom: "24px",
};

const nameStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "32px",
  fontWeight: "500" as const,
  lineHeight: "38px",
  color: EMAIL_INK,
  margin: "0",
};

const logoStyle = {
  display: "block",
  margin: "0 auto",
  width: "200px",
  maxWidth: "240px",
  height: "auto",
  maxHeight: "72px",
  border: "0",
  outline: "none",
  lineHeight: "100%",
};

const hrStyle = {
  borderTop: `1px solid ${EMAIL_LINE}`,
  borderBottom: "0",
  borderLeft: "0",
  borderRight: "0",
  margin: "24px 0",
};

const footerStyle = {
  fontFamily: EMAIL_FONT_BODY,
  color: EMAIL_MUTED,
  fontSize: "13px",
  lineHeight: "18px",
  textAlign: "center" as const,
  margin: "0",
};
