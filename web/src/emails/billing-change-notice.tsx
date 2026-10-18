import React from "react";
import { Hr, Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import {
  emailFine,
  emailHeading,
  emailText,
  type EmailT,
} from "./components/score";

export type BillingChangeNoticeProps = {
  t: EmailT;
  businessName: string;
  logoUrl?: string | null;
  date: string;
  currentRate: string;
  amount: string;
  activeProviders: number;
  textsObserved: number;
  textPeriodStart: string;
  textPeriodEnd: string;
  hasTextLine: boolean;
  usesSharedLine: boolean;
};

export function BillingChangeNotice({
  t,
  businessName,
  logoUrl,
  date,
  currentRate,
  amount,
  activeProviders,
  textsObserved,
  textPeriodStart,
  textPeriodEnd,
  hasTextLine,
  usesSharedLine,
}: BillingChangeNoticeProps) {
  return (
    <EmailLayout
      businessName={businessName}
      previewText={t("billingChange.preview", { date })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("billingChange.heading")}</Text>
      <Text style={emailText}>
        {t("billingChange.currentRate", { currentRate })}
      </Text>
      <Text style={emailText}>{t("billingChange.fromDate", { date })}</Text>

      <Section style={priceListStyle}>
        <Text style={listItemStyle}>{t("billingChange.staffPrice")}</Text>
        {hasTextLine ? (
          <Text style={listItemStyle}>{t("billingChange.textPrice")}</Text>
        ) : null}
        <Text style={listItemStyle}>{t("billingChange.processingRate")}</Text>
        <Text style={listItemStyle}>{t("billingChange.payouts")}</Text>
      </Section>

      <Hr style={dividerStyle} />
      <Text style={emailHeading}>{t("billingChange.estimateHeading")}</Text>
      <Text style={emailText}>
        {t("billingChange.estimate", { amount })}
      </Text>
      <Text style={emailFine}>
        {t("billingChange.estimateBasis", {
          activeProviders,
          textsObserved,
          start: textPeriodStart,
          end: textPeriodEnd,
        })}
      </Text>

      <Text style={emailText}>{t("billingChange.cardAction", { date })}</Text>
      {usesSharedLine ? (
        <Text style={emailText}>{t("billingChange.sharedLineSetup")}</Text>
      ) : null}
      <Text style={emailText}>
        {t("billingChange.support")}{" "}
        <a href="mailto:support@bookuptempo.com">support@bookuptempo.com</a>.
      </Text>
    </EmailLayout>
  );
}

const priceListStyle = {
  margin: "0 0 20px 0",
  padding: "0 0 0 20px",
};

const listItemStyle = {
  color: "#111111",
  fontFamily: '"Hanken Grotesk", Arial, sans-serif',
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 8px 0",
};

const dividerStyle = {
  borderTop: "1px solid #E5E5E5",
  borderBottom: "0",
  borderLeft: "0",
  borderRight: "0",
  margin: "24px 0",
};
