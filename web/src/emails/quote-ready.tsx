import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import {
  EMAIL_FONT_BODY,
  EMAIL_INK,
  emailBox,
  emailButtonStyle,
  emailCenter,
  emailFine,
  emailHeading,
  emailText,
  type EmailT,
} from "./components/score";

export interface QuoteReadyLine {
  description: string;
  quantity: number;
  amountLabel: string;
}

interface QuoteReadyEmailProps {
  t: EmailT;
  businessName: string;
  clientName: string;
  lines: QuoteReadyLine[];
  totalLabel: string;
  depositLabel: string | null;
  validUntilLabel: string;
  link: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function QuoteReadyEmail({
  t,
  businessName,
  clientName,
  lines,
  totalLabel,
  depositLabel,
  validUntilLabel,
  link,
  logoUrl,
  brandColor,
}: QuoteReadyEmailProps) {
  return (
    <EmailLayout
      businessName={businessName}
      previewText={t("quote.heading")}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("quote.heading")}</Text>
      <Text style={emailText}>{t("quote.intro", { name: clientName })}</Text>
      <Section style={emailBox}>
        {lines.map((line, i) => (
          <Text key={i} style={lineStyle}>
            {line.description}
            {line.quantity > 1 ? ` x${line.quantity}` : ""} - {line.amountLabel}
          </Text>
        ))}
        <Text style={totalStyle}>
          {t("quote.total")}: {totalLabel}
        </Text>
        {depositLabel ? (
          <Text style={lineStyle}>
            {t("quote.deposit")}: {depositLabel}
          </Text>
        ) : null}
      </Section>
      <Section style={emailCenter}>
        <Button href={link} style={emailButtonStyle(brandColor)}>
          {t("quote.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("quote.validUntil", { date: validUntilLabel })}</Text>
    </EmailLayout>
  );
}

const lineStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0 0 6px 0",
};

const totalStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  fontWeight: "500" as const,
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "8px 0 6px 0",
};
