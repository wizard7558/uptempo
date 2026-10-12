import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---------------------------------------------------------------
// vi.mock factories are hoisted above imports, so the mock fns they reference
// must be created via vi.hoisted (also hoisted) rather than plain top-level
// consts.

const { insertMock, valuesMock, returningMock, sendEmailMock, waitlistEmailMock } =
  vi.hoisted(() => {
    const returningMock = vi.fn<() => Promise<Array<{ id: string }>>>();
    const onConflictMock = vi.fn(() => ({ returning: returningMock }));
    const valuesMock = vi.fn<
      (row: Record<string, unknown>) => { onConflictDoNothing: typeof onConflictMock }
    >(() => ({ onConflictDoNothing: onConflictMock }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const sendEmailMock = vi.fn<
      (arg: { to: string | string[]; subject: string; react: unknown }) => Promise<{
        success: boolean;
      }>
    >(async () => ({ success: true }));
    const waitlistEmailMock = vi.fn<(props: Record<string, unknown>) => unknown>(
      () => ({ __email: true }),
    );
    return {
      insertMock,
      valuesMock,
      returningMock,
      sendEmailMock,
      waitlistEmailMock,
    };
  });

vi.mock("@/lib/db", () => ({
  publicDb: { insert: insertMock },
}));

vi.mock("@/lib/db/schema", () => ({
  waitlistSignups: { __table: "waitlist_signups", id: "id", email: "email" },
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: sendEmailMock,
}));

// Capture the props the notification email is built with, without rendering React.
vi.mock("@/emails/waitlist-signup", () => ({
  WaitlistSignupEmail: waitlistEmailMock,
}));

import { joinWaitlist } from "./waitlist";

/** The sanitized row passed to publicDb.insert(...).values(row). */
function savedRow() {
  expect(valuesMock).toHaveBeenCalledTimes(1);
  return valuesMock.mock.calls[0][0] as Record<string, unknown>;
}

describe("joinWaitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the insert lands a new row.
    returningMock.mockResolvedValue([{ id: "signup-1" }]);
    delete process.env.WAITLIST_NOTIFY_EMAIL;
  });

  afterEach(() => {
    delete process.env.WAITLIST_NOTIFY_EMAIL;
  });

  it("persists a full signup and reports it as new", async () => {
    const result = await joinWaitlist({
      name: "Emma Lord",
      email: "Emma@Example.com",
      phone: "555-0142",
      source: "chair",
    });

    expect(result).toEqual({ success: true, alreadyJoined: false });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(savedRow()).toEqual({
      name: "Emma Lord",
      email: "emma@example.com", // lowercased for the unique index
      phone: "555-0142",
      source: "chair",
    });
  });

  it("trims whitespace and coerces blank optional fields to null", async () => {
    await joinWaitlist({
      name: "  Emma  ",
      email: "  emma@example.com  ",
      phone: "   ",
    });

    const row = savedRow();
    expect(row.name).toBe("Emma");
    expect(row.email).toBe("emma@example.com");
    expect(row.phone).toBeNull();
    expect(row.source).toBeNull();
  });

  it("caps name and phone at their column limits", async () => {
    await joinWaitlist({
      email: "emma@example.com",
      name: "n".repeat(500),
      phone: "1".repeat(500),
    });
    const row = savedRow();
    expect((row.name as string).length).toBe(200);
    expect((row.phone as string).length).toBe(50);
  });

  it.each([
    ["Expo 2026", "expo-2026"],
    ["  CHAIR  ", "chair"],
    ["a".repeat(200), "a".repeat(64)],
    ["!!!", null],
    ["", null],
    [undefined, null],
  ])("normalizes source %p -> %p", async (input, expected) => {
    await joinWaitlist({ email: "emma@example.com", source: input });
    expect(savedRow().source).toBe(expected);
  });

  it.each([
    "not-an-email",
    "emma@",
    "@example.com",
    "emma example@test.com",
    "   ",
    undefined,
  ])("rejects invalid email %p without touching the DB", async (email) => {
    const result = await joinWaitlist({ email });
    expect(result).toEqual({ success: false, error: "invalid-email" });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("treats a duplicate signup as success and skips the notification", async () => {
    process.env.WAITLIST_NOTIFY_EMAIL = "team@example.com";
    returningMock.mockResolvedValueOnce([]); // unique index swallowed the row

    const result = await joinWaitlist({ email: "emma@example.com" });

    expect(result).toEqual({ success: true, alreadyJoined: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns success:false when the insert throws, without raising", async () => {
    returningMock.mockRejectedValueOnce(new Error("db down"));
    const result = await joinWaitlist({ email: "emma@example.com" });
    expect(result).toEqual({ success: false, error: "failed" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not notify when WAITLIST_NOTIFY_EMAIL is unset", async () => {
    await joinWaitlist({ email: "emma@example.com" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("notifies the team with the sanitized signup when the env var is set", async () => {
    process.env.WAITLIST_NOTIFY_EMAIL = "team@example.com";

    await joinWaitlist({
      name: "Emma Lord",
      email: "EMMA@example.com",
      source: "Expo 2026",
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArg = sendEmailMock.mock.calls[0][0] as { to: string[] };
    expect(emailArg.to).toEqual(["team@example.com"]);

    const props = waitlistEmailMock.mock.calls[0][0];
    expect(props.name).toBe("Emma Lord");
    expect(props.email).toBe("emma@example.com");
    expect(props.phone).toBeNull();
    expect(props.source).toBe("expo-2026");
  });

  it("notifies every address in a comma-separated list", async () => {
    process.env.WAITLIST_NOTIFY_EMAIL =
      " Riley@Example.com , emma@example.com,, bogus , riley@example.com ";

    await joinWaitlist({ email: "new@example.com" });

    const emailArg = sendEmailMock.mock.calls[0][0] as { to: string[] };
    // Normalized, deduped, and the malformed entry dropped rather than
    // poisoning the whole list.
    expect(emailArg.to).toEqual(["riley@example.com", "emma@example.com"]);
  });

  it("still returns success when the notification email throws", async () => {
    process.env.WAITLIST_NOTIFY_EMAIL = "team@example.com";
    sendEmailMock.mockRejectedValueOnce(new Error("resend boom"));

    const result = await joinWaitlist({ email: "emma@example.com" });
    expect(result).toEqual({ success: true, alreadyJoined: false });
  });
});
