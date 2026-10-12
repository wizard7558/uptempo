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

export interface QuizResponseEmailProps {
  t: EmailT;
  answers: Array<{ question: string; answer: string }>;
  submittedAt: string;
  salonName?: string;
  logoUrl?: string | null;
}

export function QuizResponseEmail({
  t,
  answers,
  submittedAt,
  salonName = PLATFORM_PRODUCT_NAME,
  logoUrl,
}: QuizResponseEmailProps) {
  return (
    <EmailLayout businessName={salonName} previewText={t("quiz.preview")} logoUrl={logoUrl} t={t}>
      <Text style={emailHeading}>{t("quiz.heading")}</Text>
      <Text style={emailMuted}>{t("quiz.submitted", { when: submittedAt })}</Text>
      <Text style={emailMuted}>{t("quiz.note")}</Text>
      <Hr style={dividerStyle} />
      {answers.length === 0 ? (
        <Text style={emailMuted}>{t("quiz.empty")}</Text>
      ) : (
        answers.map((item) => (
          <Section key={item.question} style={rowSection}>
            <Text style={questionStyle}>{item.question}</Text>
            <Text style={answerStyle}>{item.answer}</Text>
          </Section>
        ))
      )}
    </EmailLayout>
  );
}

const dividerStyle = { borderColor: EMAIL_LINE, margin: "12px 0" };
const rowSection = { margin: "0 0 14px 0" };

const questionStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "13px",
  fontWeight: "500" as const,
  color: EMAIL_MUTED,
  margin: "0 0 2px 0",
};

const answerStyle = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "18px",
  fontWeight: "500" as const,
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0",
  whiteSpace: "pre-wrap" as const,
};
