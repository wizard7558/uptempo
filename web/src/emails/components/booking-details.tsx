import { Section, Text } from "@react-email/components";
import { EMAIL_FONT_BODY, EMAIL_INK, EMAIL_MUTED, emailBox, type EmailT } from "./score";

interface BookingDetailsProps {
  t: EmailT;
  staffName: string;
  services: string[];
  date: string;
  time: string;
  duration?: string | null;
  businessAddress?: string | null;
}

export function BookingDetails({
  t,
  staffName,
  services,
  date,
  time,
  duration,
  businessAddress,
}: BookingDetailsProps) {
  return (
    <Section style={emailBox}>
      <DetailRow label={t("details.staff")} value={staffName} />
      <DetailRow label={t("details.offerings")} value={services.join(", ")} />
      <DetailRow label={t("details.date")} value={date} />
      <DetailRow label={t("details.time")} value={time} />
      {duration ? <DetailRow label={t("details.duration")} value={duration} /> : null}
      {businessAddress ? <DetailRow label={t("details.location")} value={businessAddress} /> : null}
    </Section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Text style={rowStyle}>
      <span style={labelStyle}>{label}:</span> {value}
    </Text>
  );
}

const rowStyle = {
  fontFamily: EMAIL_FONT_BODY,
  fontSize: "16px",
  lineHeight: "24px",
  color: EMAIL_INK,
  margin: "0",
};

const labelStyle = {
  fontWeight: "500" as const,
  color: EMAIL_MUTED,
};
