import { Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import {
  EMAIL_FONT_BODY,
  EMAIL_FONT_DISPLAY,
  EMAIL_INK,
  EMAIL_LINE,
  EMAIL_MUTED,
  EMAIL_PAPER,
  emailHeading,
  emailText,
  type EmailT,
} from "./components/score";

export interface GiftCardEmailProps {
  t: EmailT;
  salonName: string;
  purchaser: string;
  amount: string;
  code: string;
  message: string | null;
  balanceUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function GiftCardEmail({
  t,
  salonName,
  purchaser,
  amount,
  code,
  message,
  balanceUrl,
  logoUrl,
}: GiftCardEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("giftCard.heading")}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("giftCard.heading")}</Text>
      <Text style={emailText}>
        {t("giftCard.body", { purchaser, amount, business: salonName })}
      </Text>
      {message ? <Text style={emailText}>{message}</Text> : null}
      <Section style={codeBox}>
        <Text style={codeLabelStyle}>{t("giftCard.codeLabel")}</Text>
        <Text style={codeStyle}>{code}</Text>
      </Section>
      <Text style={emailText}>{t("giftCard.howToUse")}</Text>
      <Link href={balanceUrl} style={linkStyle}>
        {t("giftCard.balanceLink")}
      </Link>
      <Text style={fromStyle}>{t("giftCard.fromBusiness", { business: salonName })}</Text>
    </EmailLayout>
  );
}

const codeBox = {
  backgroundColor: EMAIL_PAPER,
  border: `1px solid ${EMAIL_LINE}`,
  borderRadius: "6px",
  padding: "16px",
  margin: "0 0 16px 0",
};

const codeLabelStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "13px",
  lineHeight: "18px",
  color: EMAIL_MUTED,
  margin: "0 0 4px 0",
};

const codeStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "28px",
  fontWeight: "500" as const,
  letterSpacing: "2px",
  color: EMAIL_INK,
  margin: "0",
};

const linkStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  color: EMAIL_INK,
  textDecoration: "underline",
};

const fromStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "16px 0 0 0",
};
