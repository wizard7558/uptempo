import { Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { emailButtonStyle, emailCenter, emailHeading, emailText, type EmailT } from "./components/score";

interface RequestNewEmailProps {
  t: EmailT;
  businessName: string;
  heading: string;
  body: string;
  cta: string;
  url: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}

export function RequestNewEmail({
  t,
  businessName,
  heading,
  body,
  cta,
  url,
  logoUrl,
  brandColor,
}: RequestNewEmailProps) {
  return (
    <EmailLayout businessName={businessName} previewText={heading} logoUrl={logoUrl} t={t}>
      <Text style={emailHeading}>{heading}</Text>
      <Text style={emailText}>{body}</Text>
      <Section style={emailCenter}>
        <Button href={url} style={emailButtonStyle(brandColor)}>
          {cta}
        </Button>
      </Section>
    </EmailLayout>
  );
}
