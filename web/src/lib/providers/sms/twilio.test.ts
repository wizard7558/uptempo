import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  client: { messages: { create: vi.fn() } },
}));

vi.mock("@/lib/sms/client", () => ({
  getTwilioClient: () => state.client,
  getMessagingServiceSid: () => "MG-platform-shared",
}));

import { createTwilioSmsProvider } from "./twilio";

describe("Twilio SMS provider", () => {
  beforeEach(() => {
    state.client.messages.create.mockReset().mockResolvedValue({ sid: "SM-test" });
  });

  it("uses a tenant messaging service override when supplied", async () => {
    const result = await createTwilioSmsProvider().send({
      to: "+15555550123",
      body: "Appointment reminder",
      messagingServiceSid: "MG-tenant-owned",
    });
    expect(result).toEqual({ success: true, messageSid: "SM-test" });
    expect(state.client.messages.create).toHaveBeenCalledWith({
      body: "Appointment reminder",
      messagingServiceSid: "MG-tenant-owned",
      to: "+15555550123",
    });
  });

  it("keeps the platform service as the default", async () => {
    await createTwilioSmsProvider().send({ to: "+15555550123", body: "Shared line" });
    expect(state.client.messages.create).toHaveBeenCalledWith({
      body: "Shared line",
      messagingServiceSid: "MG-platform-shared",
      to: "+15555550123",
    });
  });
});
