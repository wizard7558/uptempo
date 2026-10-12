export const BASE_CENTS = 1200;
export const EXTRA_STAFF_CENTS = 600;
export const MAX_EXTRA_STAFF = 5;
export const TEXT_LINE_CENTS = 400;
export const PER_TEXT_CENTS = 5;
export const TEXT_SETUP_CENTS = 1900;
export const HOSTED_TRIAL_DAYS = 14;

export const HOSTED_BASE_MONTHLY_LOOKUP_KEY = "hosted_base_monthly";
export const HOSTED_EXTRA_STAFF_MONTHLY_LOOKUP_KEY = "hosted_extra_staff_monthly";
export const HOSTED_TEXT_LINE_MONTHLY_LOOKUP_KEY = "hosted_text_line_monthly";
export const HOSTED_TEXTS_METERED_LOOKUP_KEY = "hosted_texts_metered";
export const HOSTED_TEXT_LINE_SETUP_LOOKUP_KEY = "hosted_text_line_setup";

export function extraStaffQuantity(billableStaff: number): number {
  return Math.min(MAX_EXTRA_STAFF, Math.max(0, billableStaff - 1));
}

export function hostedMonthlyCents(input: {
  staff: number;
  textLine: boolean;
  texts: number;
}): number {
  const staffCents =
    BASE_CENTS + extraStaffQuantity(input.staff) * EXTRA_STAFF_CENTS;
  if (!input.textLine) return staffCents;
  return staffCents + TEXT_LINE_CENTS + input.texts * PER_TEXT_CENTS;
}
