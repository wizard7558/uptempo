export interface EmailMessage {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export type EmailProviderId = "resend" | "smtp" | "console";

export interface EmailProvider {
  readonly id: EmailProviderId;
  send(msg: EmailMessage): Promise<{ success: boolean; id?: string; error?: string }>;
}
