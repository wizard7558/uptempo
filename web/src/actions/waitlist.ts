"use server";

import { publicDb } from "@/lib/db";
import { waitlistSignups } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { WaitlistSignupEmail } from "@/emails/waitlist-signup";
import { createTermsT } from "@/lib/terms/translator";
import { VERTICALS } from "@/lib/verticals";
import { cleanSource } from "@/lib/attribution";
import { normalizeEmail, parseEmailList } from "@/lib/validators/email";

export type WaitlistSubmission = {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
};

export type WaitlistResult =
  | { success: true; alreadyJoined: boolean }
  | { success: false; error: "invalid-email" | "failed" };

/** Trim a free-text field, cap its length, and coerce empty → null. */
function clean(value: string | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Add a prospect to the pre-launch waitlist. Public — called from the
 * unauthenticated `/waitlist` page. Never throws.
 *
 * Email is the only required field. Repeat signups are idempotent: the unique
 * index on `email` absorbs them and the result reports `alreadyJoined: true`,
 * which the form treats as success (re-submitting shouldn't look like an
 * error, and it shouldn't leak whether an address is already on the list).
 *
 * Side effect (best-effort): if `WAITLIST_NOTIFY_EMAIL` is set, emails the team
 * a digest of the new signup. Sent only for genuinely new rows, and email
 * failure never affects the saved result.
 */
export async function joinWaitlist(
  input: WaitlistSubmission,
): Promise<WaitlistResult> {
  // Lowercased so the unique index dedupes case variants.
  const email = normalizeEmail(input.email);
  if (!email) return { success: false, error: "invalid-email" };

  const row = {
    name: clean(input.name, 200),
    email,
    phone: clean(input.phone, 50),
    source: cleanSource(input.source),
  };

  let inserted: Array<{ id: string }>;
  try {
    inserted = await publicDb
      .insert(waitlistSignups)
      .values(row)
      .onConflictDoNothing({ target: waitlistSignups.email })
      .returning({ id: waitlistSignups.id });
  } catch (err) {
    console.error("[Waitlist] Failed to save signup:", err);
    return { success: false, error: "failed" };
  }

  // Empty `returning` means the unique index swallowed a duplicate signup.
  const alreadyJoined = inserted.length === 0;

  // Best-effort internal notification — must not affect the persisted result.
  // WAITLIST_NOTIFY_EMAIL may list several recipients, comma-separated.
  const notifyTo = parseEmailList(process.env.WAITLIST_NOTIFY_EMAIL);
  if (notifyTo.length > 0 && !alreadyJoined) {
    try {
      await sendEmail({
        to: notifyTo,
        subject: "New waitlist signup",
        react: WaitlistSignupEmail({
          t: createTermsT(VERTICALS.general.terms, "emails"),
          name: row.name,
          email: row.email,
          phone: row.phone,
          source: row.source,
          submittedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error("[Waitlist] Failed to send notification email:", err);
    }
  }

  return { success: true, alreadyJoined };
}
