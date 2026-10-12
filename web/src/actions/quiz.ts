"use server";

import { publicDb } from "@/lib/db";
import { quizResponses } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { QuizResponseEmail } from "@/emails/quiz-response";
import { createTermsT } from "@/lib/terms/translator";
import { VERTICALS } from "@/lib/verticals";
import { cleanSource } from "@/lib/attribution";
import { parseEmailList } from "@/lib/validators/email";

export type QuizSubmission = {
  name?: string;
  phone?: string;
  email?: string;
  biggestTimeWaster?: string;
  automateOneThing?: string;
  softwareRating?: number;
  favoriteThing?: string;
  leastFavoriteThing?: string;
  wishedFeature?: string;
  /** Attribution label from `?src=` (QR code, campaign link). */
  source?: string;
};

/** Trim a free-text field, cap its length, and coerce empty → null. */
function clean(value: string | undefined, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/** Clamp a 1–5 rating to an integer, or null if out of range / absent. */
function cleanRating(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1 || value > 5) return null;
  return Math.round(value);
}

/** Normalize raw input into the sanitized row we persist. */
function normalizeSubmission(input: QuizSubmission) {
  return {
    name: clean(input.name, 200),
    phone: clean(input.phone, 50),
    email: clean(input.email, 320),
    biggestTimeWaster: clean(input.biggestTimeWaster),
    automateOneThing: clean(input.automateOneThing),
    softwareRating: cleanRating(input.softwareRating),
    favoriteThing: clean(input.favoriteThing),
    leastFavoriteThing: clean(input.leastFavoriteThing),
    wishedFeature: clean(input.wishedFeature),
    source: cleanSource(input.source),
  };
}

/** Build the human-readable (question, answer) list for the digest email. */
function digestAnswers(
  row: ReturnType<typeof normalizeSubmission>,
): Array<{ question: string; answer: string }> {
  const rating = row.softwareRating;
  const pairs: Array<[string, string | null]> = [
    ["Name", row.name],
    ["Phone", row.phone],
    ["Email", row.email],
    ["What wastes the most time?", row.biggestTimeWaster],
    ["Would automate", row.automateOneThing],
    ["Software rating", rating != null ? `${rating}/5` : null],
    ["Favorite thing about it", row.favoriteThing],
    ["Least favorite thing about it", row.leastFavoriteThing],
    ["Wished-for feature", row.wishedFeature],
    ["Came from", row.source],
  ];
  return pairs
    .filter((pair): pair is [string, string] => pair[1] != null)
    .map(([question, answer]) => ({ question, answer }));
}

/**
 * Persist a prospect quiz response (platform-level, no tenant). Public — called
 * from the unauthenticated `/quiz` page. Never throws; returns a success flag.
 *
 * Side effect (best-effort): if `QUIZ_NOTIFY_EMAIL` is set, emails a digest of
 * the response to the team. Email failure never affects the save result.
 */
export async function submitQuizResponse(
  input: QuizSubmission,
): Promise<{ success: boolean }> {
  const row = normalizeSubmission(input);

  try {
    await publicDb.insert(quizResponses).values(row);
  } catch (err) {
    console.error("[Quiz] Failed to save response:", err);
    return { success: false };
  }

  // Best-effort internal notification — must not affect the persisted result.
  // QUIZ_NOTIFY_EMAIL may list several recipients, comma-separated.
  const notifyTo = parseEmailList(process.env.QUIZ_NOTIFY_EMAIL);
  if (notifyTo.length > 0) {
    try {
      await sendEmail({
        to: notifyTo,
        subject: "New quiz response",
        react: QuizResponseEmail({
          t: createTermsT(VERTICALS.general.terms, "emails"),
          answers: digestAnswers(row),
          submittedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("[Quiz] Failed to send digest email:", err);
    }
  }

  return { success: true };
}
