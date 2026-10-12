import crypto from "crypto";

function getSecret(): string {
  const secret = process.env.BOOKING_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BOOKING_SESSION_SECRET is required in production");
  }
  return secret || "dev-secret";
}

interface TokenPayload {
  appointmentId: string;
  action:
    | "cancel"
    | "reschedule"
    | "checkout"
    | "form"
    | "aftercare"
    | "intake";
  formResponseId?: string;
  intakeSignatureId?: string;
  exp: number; // Unix timestamp in seconds
}

/**
 * Create an HMAC-signed action token for cancel/reschedule links in emails.
 * Token format: {base64url_payload}.{base64url_hmac}
 */
export function createActionToken(
  appointmentId: string,
  action:
    | "cancel"
    | "reschedule"
    | "checkout"
    | "form"
    | "aftercare"
    | "intake",
  expiryHours = 72,
): string {
  const payload: TokenPayload = {
    appointmentId,
    action,
    exp: Math.floor(Date.now() / 1000) + expiryHours * 3600,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${hmac}`;
}

/**
 * Verify an HMAC-signed action token.
 * Returns the decoded payload if valid and not expired, null otherwise.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyActionToken(
  token: string,
): TokenPayload | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadStr = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  // Recompute HMAC
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("base64url");

  // Timing-safe comparison
  try {
    const sigBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    if (sigBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
  } catch {
    return null;
  }

  // Decode payload
  try {
    const payload: TokenPayload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf-8"),
    );

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    // Validate structure
    if (!payload.appointmentId || !payload.action) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create a signed token specifically for form submission links.
 * Default expiry: 168 hours (7 days) -- longer than cancel/reschedule since
 * clients may delay filling out forms before their appointment.
 */
export function createFormToken(
  formResponseId: string,
  appointmentId: string,
  expiryHours = 168,
): string {
  const payload: TokenPayload = {
    appointmentId,
    action: "form",
    formResponseId,
    exp: Math.floor(Date.now() / 1000) + expiryHours * 3600,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${hmac}`;
}

/**
 * Create a signed token for intake (policies + card-on-file) links.
 * Default expiry: 168 hours (7 days). The signatureId points at the
 * `policy_signatures` row created when the link was sent.
 */
export function createIntakeToken(
  intakeSignatureId: string,
  appointmentId: string,
  expiryHours = 168,
): string {
  const payload: TokenPayload = {
    appointmentId,
    action: "intake",
    intakeSignatureId,
    exp: Math.floor(Date.now() / 1000) + expiryHours * 3600,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${hmac}`;
}
