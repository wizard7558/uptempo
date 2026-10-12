export type SmsProviderId = "twilio" | "loopmessage" | "none" | "log";

export interface SmsSendInput {
  to: string;
  body: string;
  statusCallbackUrl?: string;
  /** Echoed by LoopMessage webhooks so the tenant can be resolved. */
  passthrough?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

export interface SmsProvider {
  readonly id: SmsProviderId;
  readonly enabled: boolean;
  send(input: SmsSendInput): Promise<SmsSendResult>;
}
