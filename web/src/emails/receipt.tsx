import { Text, Section, Row, Column } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { EMAIL_FONT_BODY, EMAIL_INK, EMAIL_LINE, emailHeading, emailMuted, type EmailT } from "./components/score";

export interface ReceiptLineItem {
  label: string;
  amountCents: number;
}

interface ReceiptEmailProps {
  t: EmailT;
  salonName: string;
  clientName: string;
  lineItems: ReceiptLineItem[];
  tipCents: number;
  totalCents: number;
  paidAtLabel: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ReceiptEmail({
  t,
  salonName,
  clientName,
  lineItems,
  tipCents,
  totalCents,
  paidAtLabel,
  logoUrl,
}: ReceiptEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("receiptMail.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("receiptMail.greeting", { name: clientName })}</Text>
      <Text style={emailMuted}>{t("receiptMail.body", { business: salonName, paidAt: paidAtLabel })}</Text>
      <Text style={emailMuted}>{t("receiptMail.withStaff")}</Text>
      <Section style={tableSection}>
        {lineItems.map((row, i) => (
          <Row key={i} style={rowStyle}>
            <Column style={labelCol}>{row.label}</Column>
            <Column style={amountCol}>{formatMoney(row.amountCents)}</Column>
          </Row>
        ))}
        {tipCents > 0 ? (
          <Row style={rowStyle}>
            <Column style={labelCol}>{t("receiptMail.tip")}</Column>
            <Column style={amountCol}>{formatMoney(tipCents)}</Column>
          </Row>
        ) : null}
        <Row style={totalRowStyle}>
          <Column style={labelCol}>{t("receiptMail.total")}</Column>
          <Column style={amountCol}>{formatMoney(totalCents)}</Column>
        </Row>
      </Section>
    </EmailLayout>
  );
}

const tableSection = { marginTop: "8px", marginBottom: "8px" };

const rowStyle = { borderBottom: `1px solid ${EMAIL_LINE}` };

const totalRowStyle = { ...rowStyle, fontWeight: "500" as const };

const labelCol = {
  width: "70%",
  padding: "10px 0",
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  color: EMAIL_INK,
};

const amountCol = {
  width: "30%",
  padding: "10px 0",
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  textAlign: "right" as const,
  color: EMAIL_INK,
};
