import type { TranslationValues } from "next-intl";
import { DEFAULT_BOOKING_THEME, effectiveBrandColor } from "@/lib/booking/theme";
import { contrastRatio } from "@/lib/utils/contrast";

export type EmailT = (key: string, values?: TranslationValues) => string;

export const EMAIL_INK = "#111111";
export const EMAIL_PAPER = "#FFFFFF";
export const EMAIL_MUTED = "#5C5C5C";
export const EMAIL_LINE = "#E5E5E5";
export const EMAIL_FONT_BODY = '"Hanken Grotesk", Arial, sans-serif';
export const EMAIL_FONT_DISPLAY = '"Bodoni Moda", Georgia, serif';

const BUTTON_TEXT_MIN = 4.5;

export function emailButtonColors(brandColor?: string | null): {
  backgroundColor: string;
  color: string;
} {
  const backgroundColor = effectiveBrandColor({
    brandColor: brandColor?.trim() || DEFAULT_BOOKING_THEME.brandColor,
    colorMode: "light",
  });
  const color =
    contrastRatio(EMAIL_INK, backgroundColor) >= BUTTON_TEXT_MIN ? EMAIL_INK : EMAIL_PAPER;
  return { backgroundColor, color };
}

export function emailButtonStyle(brandColor?: string | null) {
  return {
    ...emailButtonColors(brandColor),
    fontFamily: EMAIL_FONT_BODY,
    fontSize: "16px",
    fontWeight: "500" as const,
    lineHeight: "20px",
    padding: "14px 24px",
    borderRadius: "6px",
    textDecoration: "none",
    display: "inline-block" as const,
    textAlign: "center" as const,
  };
}

export const emailHeading = {
  fontFamily: EMAIL_FONT_DISPLAY,
  fontSize: "28px",
  fontWeight: "500" as const,
  lineHeight: "34px",
  color: EMAIL_INK,
  margin: "0 0 12px 0",
};

export const emailText = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0 0 16px 0",
};

export const emailMuted = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "14px",
  lineHeight: "22px",
  color: EMAIL_MUTED,
  margin: "0 0 16px 0",
};

export const emailFine = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "13px",
  lineHeight: "18px",
  color: EMAIL_MUTED,
  margin: "8px 0 0 0",
  textAlign: "center" as const,
};

export const emailCenter = {
  textAlign: "center" as const,
  margin: "24px 0",
};

export const emailBox = {
  border: `1px solid ${EMAIL_LINE}`,
  borderRadius: "6px",
  padding: "16px 20px",
  margin: "16px 0",
};
