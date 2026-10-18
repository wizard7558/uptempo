import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: public bookings stopped getting a confirmation email, text, or
 * intake forms once the staff guard landed on the `getAppointment` action. A
 * public client has no staff session, so the guard threw and the outer catch in
 * `sendBookingConfirmations` swallowed it. These tests run the whole path with
 * no session at all.
 */

const SLUG = "demo-barber";
const APPT_ID = "8ff9b3de-0000-4000-8000-000000000001";

// No staff session anywhere: every guard throws, like a public client.
class AuthError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}
const requireStaff = vi.fn(async () => {
  throw new AuthError("UNAUTHENTICATED", "Not signed in");
});
vi.mock("@/lib/auth/rbac", () => ({
  AuthError,
  requireStaff,
  requireRole: requireStaff,
  requireAdminRole: requireStaff,
}));
// If confirmations ever imports the guarded action again, it hits the guard.
vi.mock("@/actions/appointments", () => ({
  getAppointment: async () => {
    await requireStaff();
  },
}));
vi.mock("@/actions/forms", () => ({
  getFormsForServices: async () => {
    await requireStaff();
  },
}));

const loadAppointmentForTenant = vi.fn();
vi.mock("@/lib/appointments/load", () => ({ loadAppointmentForTenant }));
const loadFormsForServices = vi.fn();
vi.mock("@/lib/forms/for-services", () => ({ loadFormsForServices }));

const withTenantDb = vi.fn();
vi.mock("@/lib/db/tenant", () => ({ withTenantDb }));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (key: string) => key,
}));
vi.mock("@/lib/terms/email", () => ({
  getEmailT: async () => (key: string) => key,
}));
vi.mock("@/lib/email/branding", () => ({
  getEmailBranding: async () => ({
    salonName: "Demo Barber",
    logoUrl: null,
    brandColor: null,
  }),
}));
const getNotificationSettingsForTenant = vi.fn();
vi.mock("@/lib/notifications/settings", () => ({ getNotificationSettingsForTenant }));
vi.mock("@/lib/booking/public-url", () => ({
  tenantPublicBaseUrl: () => "https://demo-barber.example.test",
}));
vi.mock("@/lib/email/tokens", () => ({
  createActionToken: (_id: string, action: string) => `tok-${action}`,
  createFormToken: () => "tok-form",
}));
vi.mock("@/emails/booking-confirmation", () => ({ BookingConfirmation: () => null }));
vi.mock("@/emails/form-request", () => ({ FormRequestEmail: () => null }));
vi.mock("@/lib/push/apns", () => ({
  sendApnsNotifications: vi.fn(),
  bundleIdForOwnerType: () => "com.example",
}));
const sendEmail = vi.fn(async () => undefined);
vi.mock("@/lib/email/send", () => ({ sendEmail }));
const sendSms = vi.fn(async () => undefined);
vi.mock("@/lib/sms/send", () => ({ sendSms }));

const appointment = {
  id: APPT_ID,
  staffId: "staff-1",
  start: new Date("2026-10-20T15:00:00Z"),
  client: { id: "client-1", name: "Casey", email: "casey@example.test", phone: "+15555550100" },
  location: null,
  services: [{ serviceId: "svc-1", serviceName: "Haircut", durationMinutes: 30 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  loadAppointmentForTenant.mockResolvedValue(appointment);
  loadFormsForServices.mockResolvedValue([]);
  getNotificationSettingsForTenant.mockResolvedValue({
    confirmationEnabled: true,
    smsConfirmationEnabled: 1,
    smsFormRequestsEnabled: 1,
    businessAddress: null,
    confirmationGreeting: null,
    confirmationBody: null,
    smsConfirmationBody: null,
  });
  // Call order in sendBookingConfirmations: staff name, timezone, owner devices,
  // then one form_responses insert per form.
  withTenantDb
    .mockResolvedValueOnce("Pat")
    .mockResolvedValueOnce("America/Chicago")
    .mockResolvedValueOnce([])
    .mockResolvedValue([{ id: "response-1" }]);
});

describe("sendBookingConfirmations with no session", () => {
  it("loads the appointment by the trusted slug and sends the email and text", async () => {
    const { sendBookingConfirmations } = await import("./confirmations");
    await sendBookingConfirmations(SLUG, APPT_ID);

    expect(requireStaff).not.toHaveBeenCalled();
    expect(loadAppointmentForTenant).toHaveBeenCalledWith(SLUG, APPT_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "casey@example.test", salonName: "Demo Barber" }),
    );
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+15555550100",
        tenantSlug: SLUG,
        appointmentId: APPT_ID,
        messageType: "confirmation",
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sends the intake form request for the booked services", async () => {
    loadFormsForServices.mockResolvedValue([
      { id: "form-1", name: "Consent", description: null, fields: [] },
    ]);
    const { sendBookingConfirmations } = await import("./confirmations");
    await sendBookingConfirmations(SLUG, APPT_ID);

    expect(loadFormsForServices).toHaveBeenCalledWith(SLUG, ["svc-1"]);
    // Confirmation email plus the form request email.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "form_request", tenantSlug: SLUG }),
    );
    expect(requireStaff).not.toHaveBeenCalled();
  });
});
