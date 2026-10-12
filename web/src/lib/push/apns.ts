import crypto from "node:crypto";
import http2 from "node:http2";

/**
 * Minimal Apple Push Notification service (APNs) sender using token-based
 * (JWT/ES256) authentication over HTTP/2 — no third-party SDK.
 *
 * Configuration (Vercel env; never commit the key):
 *   APNS_KEY_ID       – the .p8 key's Key ID
 *   APNS_TEAM_ID      – Apple Developer Team ID
 *   APNS_PRIVATE_KEY  – contents of the AuthKey_XXXX.p8 (PEM; \n may be escaped)
 *   APNS_BUNDLE_ID_CLIENT / APNS_BUNDLE_ID_OWNER – per-app topics
 *
 * When the key vars are absent (local/dev/test) sending is a logged no-op that
 * "succeeds", mirroring src/lib/email/send.ts and src/lib/sms/send.ts.
 */

const PROD_HOST = "https://api.push.apple.com";
const SANDBOX_HOST = "https://api.sandbox.push.apple.com";

export type ApnsEnvironment = "sandbox" | "production";

export interface ApnsTarget {
  apnsToken: string;
  environment: ApnsEnvironment;
}

export interface ApnsMessage {
  title: string;
  body: string;
  /** Custom data delivered alongside the alert (e.g. deep-link path). */
  data?: Record<string, string>;
  badge?: number;
}

export interface ApnsSendResult {
  apnsToken: string;
  ok: boolean;
  status: number;
  /** True when Apple says the token is invalid (400 BadDeviceToken / 410). */
  shouldRevoke: boolean;
  reason?: string;
}

function privateKey(): string {
  return (process.env.APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
}

export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_PRIVATE_KEY,
  );
}

/** Resolve the APNs topic (bundle id) for an owner type. */
export function bundleIdForOwnerType(
  ownerType: "client" | "user",
): string | undefined {
  return ownerType === "client"
    ? process.env.APNS_BUNDLE_ID_CLIENT
    : process.env.APNS_BUNDLE_ID_OWNER;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// JWTs are valid up to 1h; Apple recommends reusing for <60 min. Cache by kid.
let cachedJwt: { token: string; iat: number } | null = null;

export function buildApnsAuthToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.iat < 50 * 60) {
    return cachedJwt.token;
  }
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID }),
  );
  const payload = base64url(
    JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now }),
  );
  const signingInput = `${header}.${payload}`;
  // EC P-256 signatures must be in JOSE (r||s) form, not DER.
  const signature = crypto.sign("SHA256", Buffer.from(signingInput), {
    key: privateKey(),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token, iat: now };
  return token;
}

function hostFor(environment: ApnsEnvironment): string {
  return environment === "sandbox" ? SANDBOX_HOST : PROD_HOST;
}

function payloadFor(message: ApnsMessage): string {
  const aps: Record<string, unknown> = {
    alert: { title: message.title, body: message.body },
    sound: "default",
  };
  if (typeof message.badge === "number") aps.badge = message.badge;
  return JSON.stringify({ aps, ...(message.data ?? {}) });
}

/**
 * Send one alert to many device tokens that share a topic. Opens one HTTP/2
 * session per environment host and multiplexes the requests over it.
 * Returns a per-token result so callers can revoke dead tokens.
 */
export async function sendApnsNotifications(
  targets: ApnsTarget[],
  message: ApnsMessage,
  topic: string,
): Promise<ApnsSendResult[]> {
  if (targets.length === 0) return [];

  if (!isApnsConfigured() || !topic) {
    console.log(
      `[APNs] Not configured — skipping ${targets.length} notification(s): "${message.title}"`,
    );
    return targets.map((t) => ({
      apnsToken: t.apnsToken,
      ok: true,
      status: 200,
      shouldRevoke: false,
    }));
  }

  const authToken = buildApnsAuthToken();
  const body = payloadFor(message);

  // Group by host (sandbox vs production) — one session each.
  const byHost = new Map<string, ApnsTarget[]>();
  for (const t of targets) {
    const host = hostFor(t.environment);
    const list = byHost.get(host) ?? [];
    list.push(t);
    byHost.set(host, list);
  }

  const results: ApnsSendResult[] = [];

  for (const [host, hostTargets] of byHost) {
    const session = http2.connect(host);
    const sessionError = new Promise<never>((_, reject) => {
      session.once("error", reject);
    });

    try {
      const sends = hostTargets.map(
        (target) =>
          Promise.race([
            sendOne(session, target.apnsToken, authToken, topic, body),
            sessionError,
          ]).catch(
            (err): ApnsSendResult => ({
              apnsToken: target.apnsToken,
              ok: false,
              status: 0,
              shouldRevoke: false,
              reason: err instanceof Error ? err.message : "send failed",
            }),
          ),
      );
      results.push(...(await Promise.all(sends)));
    } finally {
      session.close();
    }
  }

  return results;
}

function sendOne(
  session: http2.ClientHttp2Session,
  deviceToken: string,
  authToken: string,
  topic: string,
  body: string,
): Promise<ApnsSendResult> {
  return new Promise<ApnsSendResult>((resolve) => {
    const req = session.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${authToken}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";

    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      // 410 = token no longer active; 400 BadDeviceToken = invalid token.
      const reason = responseBody
        ? (() => {
            try {
              return JSON.parse(responseBody).reason as string;
            } catch {
              return undefined;
            }
          })()
        : undefined;
      const shouldRevoke =
        status === 410 || (status === 400 && reason === "BadDeviceToken");
      resolve({
        apnsToken: deviceToken,
        ok: status === 200,
        status,
        shouldRevoke,
        reason,
      });
    });
    req.on("error", (err) => {
      resolve({
        apnsToken: deviceToken,
        ok: false,
        status: 0,
        shouldRevoke: false,
        reason: err.message,
      });
    });

    req.end(body);
  });
}
