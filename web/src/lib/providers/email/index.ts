import { readProviderEnv, resolveEmailProviderId } from "../env";
import { createConsoleEmailProvider } from "./console";
import { createResendEmailProvider } from "./resend";
import { createSmtpEmailProvider } from "./smtp";
import type { EmailProvider } from "./types";

export type { EmailMessage, EmailProvider, EmailProviderId } from "./types";

/** Selects the email backend from env on every call. */
export function getEmailProvider(): EmailProvider {
  switch (resolveEmailProviderId(readProviderEnv())) {
    case "resend":
      return createResendEmailProvider();
    case "smtp":
      return createSmtpEmailProvider();
    default:
      return createConsoleEmailProvider();
  }
}
