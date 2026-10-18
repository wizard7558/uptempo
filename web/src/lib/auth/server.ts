import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { getUptempoMode } from "@/lib/config/mode";
import { getBaseUrl } from "@/lib/utils";

const rootDomain = (process.env.ROOT_DOMAIN || "bookuptempo.com").trim();

function trustedOriginsForInstall(): string[] {
  const extra = (process.env.AUTH_EXTRA_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins =
    getUptempoMode() === "single"
      ? [new URL(getBaseUrl()).origin, "http://localhost:3000" /* pragma: allowlist secret */]
      : [
          `https://${rootDomain}`,
          `https://www.${rootDomain}`,
          // Explicit apex/www entries so auth keeps trusting the canonical host even
          // when ROOT_DOMAIN is overridden per environment (e.g. preview).
          "https://bookuptempo.com",
          "https://www.bookuptempo.com",
          "http://localhost:3000" /* pragma: allowlist secret */,
          "https://emme-scheduler.vercel.app",
        ];

  if (getUptempoMode() !== "single") {
    if (process.env.VERCEL_URL) {
      origins.push(`https://${process.env.VERCEL_URL}`);
    }
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
    }
  }

  return [...origins, ...extra];
}

const trustedOrigins = trustedOriginsForInstall();
const devPort = process.env.PORT ?? "3000";
for (const host of ["localhost", "127.0.0.1"]) {
  const origin = `http://${host}:${devPort}`;
  if (!trustedOrigins.includes(origin)) trustedOrigins.push(origin);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`\n[Password Reset] ${user.email}: ${url}\n`);
        return;
      }
      const result = await sendEmail({
        to: user.email,
        subject: "Reset your Uptempo password",
        html: `
          <p>Hi ${user.name || "there"},</p>
          <p>We received a request to reset your password. Click the link below to set a new one:</p>
          <p><a href="${url}">Reset your password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          <p>— Uptempo</p>
        `,
      });
      if (!result.success) {
        console.error("[Password Reset] Email error:", result.error);
        throw new Error(
          result.error
            ? `Failed to send reset email: ${result.error}`
            : "Failed to send reset email",
        );
      }
      console.log("[Password Reset] Sent to", user.email, "id:", result.id);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
  },
});
