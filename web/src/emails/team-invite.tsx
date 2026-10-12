import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailFine, emailHeading, emailText, type EmailT } from "./components/score";

interface TeamInviteEmailProps {
  t: EmailT;
  salonName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function TeamInviteEmail({
  t,
  salonName,
  inviterName,
  roleLabel,
  acceptUrl,
  logoUrl,
  brandColor,
}: TeamInviteEmailProps) {
  return (
    <EmailLayout
      businessName={salonName}
      previewText={t("team.preview", { business: salonName })}
      logoUrl={logoUrl}
      t={t}
    >
      <Text style={emailHeading}>{t("team.heading")}</Text>
      <Text style={emailText}>
        {t("team.body", { inviter: inviterName, business: salonName, role: roleLabel })}
      </Text>
      <Text style={emailText}>{t("team.next")}</Text>
      <Section style={emailCenter}>
        <Button href={acceptUrl} style={emailButtonStyle(brandColor)}>
          {t("team.cta")}
        </Button>
      </Section>
      <Text style={emailFine}>{t("team.expires")}</Text>
    </EmailLayout>
  );
}
