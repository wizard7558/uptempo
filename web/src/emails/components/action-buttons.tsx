import { Section, Button, Text, Link } from "@react-email/components";
import { EMAIL_FONT_BODY, EMAIL_INK, EMAIL_MUTED, emailButtonStyle, emailCenter, type EmailT } from "./score";

interface ActionButtonsProps {
  cancelUrl: string;
  rescheduleUrl: string;
  t: EmailT;
  brandColor?: string | null;
}

export function ActionButtons({ cancelUrl, rescheduleUrl, t, brandColor }: ActionButtonsProps) {
  return (
    <Section style={emailCenter}>
      <Button href={rescheduleUrl} style={emailButtonStyle(brandColor)}>
        {t("actions.reschedule")}
      </Button>
      <Text style={cancelTextStyle}>
        {t("actions.cancelPrompt")}{" "}
        <Link href={cancelUrl} style={cancelLinkStyle}>
          {t("actions.cancel")}
        </Link>
      </Text>
    </Section>
  );
}

const cancelTextStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "14px",
  lineHeight: "22px",
  color: EMAIL_MUTED,
  marginTop: "12px",
};

const cancelLinkStyle = {
  color: EMAIL_INK,
  textDecoration: "underline",
};
