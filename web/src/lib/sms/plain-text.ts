/** Text messages are plain ASCII. Smart quotes and dashes become plain ones, and anything else is dropped. */
export function toPlainSms(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const toPlainAscii = toPlainSms;

export const MANUAL_SMS_MAX = 320;

export function prepareManualSms(
  input: string,
): { ok: true; body: string } | { ok: false; error: "empty" | "too_long" } {
  const body = toPlainSms(input);
  if (body.length === 0) return { ok: false, error: "empty" };
  if (body.length > MANUAL_SMS_MAX) return { ok: false, error: "too_long" };
  return { ok: true, body };
}
