import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---------------------------------------------------------------
// vi.mock factories are hoisted above imports, so the mock fns they reference
// must be created via vi.hoisted (also hoisted) rather than plain top-level
// consts.

const { insertMock, valuesMock, sendEmailMock, quizEmailMock } = vi.hoisted(
  () => {
    const valuesMock =
      vi.fn<(row: Record<string, unknown>) => Promise<void>>();
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const sendEmailMock =
      vi.fn<(arg: { to: string | string[]; subject: string; react: unknown }) => Promise<{
        success: boolean;
      }>>(async () => ({ success: true }));
    const quizEmailMock =
      vi.fn<(props: {
        answers: Array<{ question: string; answer: string }>;
        submittedAt: string;
      }) => unknown>(() => ({ __email: true }));
    return { insertMock, valuesMock, sendEmailMock, quizEmailMock };
  },
);

vi.mock("@/lib/db", () => ({
  publicDb: { insert: insertMock },
}));

vi.mock("@/lib/db/schema", () => ({
  quizResponses: { __table: "quiz_responses" },
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: sendEmailMock,
}));

// Capture the props the digest email is built with, without rendering React.
vi.mock("@/emails/quiz-response", () => ({
  QuizResponseEmail: quizEmailMock,
}));

import { submitQuizResponse } from "./quiz";

/** The sanitized row passed to publicDb.insert(...).values(row). */
function savedRow() {
  expect(valuesMock).toHaveBeenCalledTimes(1);
  return valuesMock.mock.calls[0][0] as Record<string, unknown>;
}

describe("submitQuizResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    valuesMock.mockResolvedValue(undefined);
    delete process.env.QUIZ_NOTIFY_EMAIL;
  });

  afterEach(() => {
    delete process.env.QUIZ_NOTIFY_EMAIL;
  });

  it("persists a full response and returns success", async () => {
    const result = await submitQuizResponse({
      name: "Emma Lord",
      phone: "555-0142",
      email: "emma@example.com",
      biggestTimeWaster: "Texting clients back",
      automateOneThing: "Rebooking reminders",
      softwareRating: 3,
      favoriteThing: "It works",
      leastFavoriteThing: "Too many add-ons",
      wishedFeature: "ROI alerts",
      source: "chair",
    });

    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(savedRow()).toEqual({
      name: "Emma Lord",
      phone: "555-0142",
      email: "emma@example.com",
      biggestTimeWaster: "Texting clients back",
      automateOneThing: "Rebooking reminders",
      softwareRating: 3,
      favoriteThing: "It works",
      leastFavoriteThing: "Too many add-ons",
      wishedFeature: "ROI alerts",
      source: "chair",
    });
  });

  it.each([
    ["Expo 2026", "expo-2026"],
    ["  CHAIR  ", "chair"],
    ["!!!", null],
    [undefined, null],
  ])("normalizes source %p -> %p", async (input, expected) => {
    await submitQuizResponse({ source: input });
    expect(savedRow().source).toBe(expected);
  });

  it("trims whitespace and coerces empty strings to null", async () => {
    await submitQuizResponse({
      name: "  Emma  ",
      email: "   ",
      biggestTimeWaster: "  Admin work  ",
      automateOneThing: "   ",
      favoriteThing: "",
    });

    const row = savedRow();
    expect(row.name).toBe("Emma");
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.biggestTimeWaster).toBe("Admin work");
    expect(row.automateOneThing).toBeNull();
    expect(row.favoriteThing).toBeNull();
    expect(row.wishedFeature).toBeNull();
    expect(row.source).toBeNull();
  });

  it("caps long free-text fields at 2000 chars", async () => {
    await submitQuizResponse({ wishedFeature: "y".repeat(5000) });
    expect((savedRow().wishedFeature as string).length).toBe(2000);
  });

  it("caps contact fields at their shorter limits", async () => {
    await submitQuizResponse({
      name: "n".repeat(500),
      phone: "1".repeat(500),
      email: "e".repeat(500),
    });
    const row = savedRow();
    expect((row.name as string).length).toBe(200);
    expect((row.phone as string).length).toBe(50);
    expect((row.email as string).length).toBe(320);
  });

  it.each([
    [0, null],
    [6, null],
    [-1, null],
    [Number.NaN, null],
    [1, 1],
    [5, 5],
    [3.4, 3],
    [undefined, null],
  ])("clamps softwareRating %p -> %p", async (input, expected) => {
    await submitQuizResponse({ softwareRating: input as number | undefined });
    expect(savedRow().softwareRating).toBe(expected);
  });

  it("returns success:false when the insert throws, without raising", async () => {
    valuesMock.mockRejectedValueOnce(new Error("db down"));
    const result = await submitQuizResponse({ biggestTimeWaster: "x" });
    expect(result).toEqual({ success: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not send a digest email when QUIZ_NOTIFY_EMAIL is unset", async () => {
    await submitQuizResponse({ biggestTimeWaster: "x" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends a digest with only the filled-in answers when notify email is set", async () => {
    process.env.QUIZ_NOTIFY_EMAIL = "team@example.com";

    await submitQuizResponse({
      name: "Emma Lord",
      email: "emma@example.com",
      biggestTimeWaster: "Admin work",
      softwareRating: 4,
      favoriteThing: "   ", // blank -> excluded
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArg = sendEmailMock.mock.calls[0][0] as { to: string[] };
    expect(emailArg.to).toEqual(["team@example.com"]);

    const props = quizEmailMock.mock.calls[0][0] as {
      answers: Array<{ question: string; answer: string }>;
    };
    const questions = props.answers.map((a) => a.question);
    expect(questions).toContain("Name");
    expect(questions).toContain("Email");
    expect(questions).not.toContain("Phone");
    expect(questions).toContain("What wastes the most time?");
    expect(questions).toContain("Software rating");
    expect(questions).not.toContain("Favorite thing about it");
    const rating = props.answers.find((a) => a.question === "Software rating");
    expect(rating?.answer).toBe("4/5");
  });

  it("sends the digest to every address in a comma-separated list", async () => {
    process.env.QUIZ_NOTIFY_EMAIL =
      " Riley@Example.com , emma@example.com,, bogus , riley@example.com ";

    await submitQuizResponse({ biggestTimeWaster: "x" });

    const emailArg = sendEmailMock.mock.calls[0][0] as { to: string[] };
    expect(emailArg.to).toEqual(["riley@example.com", "emma@example.com"]);
  });

  it("still returns success when the digest email throws", async () => {
    process.env.QUIZ_NOTIFY_EMAIL = "team@example.com";
    sendEmailMock.mockRejectedValueOnce(new Error("resend boom"));

    const result = await submitQuizResponse({ biggestTimeWaster: "x" });
    expect(result).toEqual({ success: true });
  });
});
