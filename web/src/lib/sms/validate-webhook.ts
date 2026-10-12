/**
 * Validate an incoming Twilio webhook request signature.
 * Uses the official twilio.validateRequest method which computes
 * HMAC-SHA1 over the URL + sorted POST params and compares to
 * the X-Twilio-Signature header.
 *
 * @param url - The full URL Twilio sent the request to
 * @param params - The POST body parameters as key-value pairs
 * @param signature - The X-Twilio-Signature header value
 * @returns true if the request is authentically from Twilio
 */
export function validateTwilioWebhook(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require("twilio");
  return twilio.validateRequest(authToken, signature, url, params) as boolean;
}
