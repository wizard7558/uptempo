export interface SmsTemplateValues {
  client: string;
  /** Staff member's display name. Fills both `{staff}` and the legacy `{stylist}`. */
  staff: string;
  date: string;
  time: string;
  services: string;
  business?: string;
  link?: string;
  minutes?: string;
}

/**
 * Default confirmation text. Uses the industry-neutral `{staff}` placeholder.
 */
export const DEFAULT_SMS_CONFIRMATION_TEMPLATE =
  "Hi {client}, you're booked with {staff} on {date} at {time}. Services: {services}.";

export const DEFAULT_SMS_QUEUE_JOINED_TEMPLATE =
  "{business}: you're in line. See your place: {link}";

export const DEFAULT_SMS_QUEUE_CALLED_TEMPLATE =
  "{business}: it's your turn. Please come to the front desk. {staff} is ready for you.";

export const DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE =
  "{business}: a time opened up with {staff} on {date} at {time}. We're holding it for {minutes} minutes. Book it here: {link}";

/**
 * Substitutes SMS template placeholders. `{stylist}` is the legacy spelling
 * still present in templates stored by tenants, so it keeps working alongside
 * `{staff}`.
 */
export function renderSmsTemplate(
  template: string,
  values: SmsTemplateValues,
): string {
  let out = template
    .replaceAll("{client}", values.client)
    .replaceAll("{stylist}", values.staff)
    .replaceAll("{staff}", values.staff)
    .replaceAll("{date}", values.date)
    .replaceAll("{time}", values.time)
    .replaceAll("{services}", values.services);
  // Optional values: an undefined one leaves its literal placeholder untouched.
  if (values.business !== undefined) out = out.replaceAll("{business}", values.business);
  if (values.link !== undefined) out = out.replaceAll("{link}", values.link);
  if (values.minutes !== undefined) out = out.replaceAll("{minutes}", values.minutes);
  return out;
}
