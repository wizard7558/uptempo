"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { joinWaitlist } from "@/actions/waitlist";
import { viaQuizSource } from "@/lib/attribution";
import { isLikelyEmail } from "@/lib/validators/email";

type Status = "idle" | "joining" | "joined" | "declined";

/**
 * Post-quiz waitlist opt-in, shown on the quiz's thank-you screen.
 *
 * The quiz already collected name / phone / email, so when it captured a usable
 * address this really is one tap — nothing gets re-typed. Every contact field
 * on the quiz is skippable though, so when there's no usable address we fall
 * back to asking for just the email rather than dropping the prompt entirely
 * (that case is common, and silently hiding it would lose the signup).
 *
 * Opting in is explicit and declining is a real, visible choice — the quiz is a
 * feedback survey, so contact details given there are not treated as consent to
 * be added to a launch list.
 */
export function QuizWaitlistPrompt({
  name,
  email,
  phone,
  source,
}: {
  name: string;
  email: string;
  phone: string;
  source: string | null;
}) {
  // Whether the quiz captured an address we can actually use for a one-tap yes.
  const quizEmailUsable = isLikelyEmail(email);

  const [status, setStatus] = useState<Status>("idle");
  const [fallbackEmail, setFallbackEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveEmail = quizEmailUsable ? email : fallbackEmail;
  const canSubmit = isLikelyEmail(effectiveEmail);

  async function handleJoin() {
    setError(null);
    setStatus("joining");
    try {
      const result = await joinWaitlist({
        name,
        email: effectiveEmail,
        phone,
        // Keep the original placement, tagged as a quiz-sourced signup.
        source: viaQuizSource(source),
      });
      if (result.success) {
        // A duplicate is still a yes — don't make it look like a failure.
        setStatus("joined");
      } else if (result.error === "invalid-email") {
        setError("That email doesn't look right. Mind checking it?");
        setStatus("idle");
      } else {
        setError("Something went wrong. Please try again.");
        setStatus("idle");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "declined") return null;

  if (status === "joined") {
    return (
      <div className="mt-6 border-t border-border pt-6">
        <p className="text-sm text-foreground">
          You&apos;re on the waitlist — we&apos;ll email{" "}
          <span className="font-medium">{effectiveEmail}</span> when your spot
          opens up.
        </p>
      </div>
    );
  }

  const isJoining = status === "joining";

  return (
    <div className="mt-6 space-y-4 border-t border-border pt-6 text-left">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Want early access?
        </h3>
        <p className="text-sm text-muted-foreground">
          {quizEmailUsable ? (
            <>
              We&apos;ll add <span className="font-medium">{email}</span> to the
              waitlist and email you when your spot opens up.
            </>
          ) : (
            <>
              Leave an email and we&apos;ll let you know when your spot opens
              up.
            </>
          )}
        </p>
      </div>

      {!quizEmailUsable ? (
        <Field label="Email" htmlFor="waitlist-prompt-email">
          <Input
            id="waitlist-prompt-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={fallbackEmail}
            onChange={(e) => setFallbackEmail(e.target.value)}
            disabled={isJoining}
          />
        </Field>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="default"
          
          onClick={handleJoin}
          disabled={isJoining || !canSubmit}
        >
          {isJoining ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : quizEmailUsable ? (
            "Yes, add me"
          ) : (
            "Join the waitlist"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          
          onClick={() => setStatus("declined")}
          disabled={isJoining}
        >
          No thanks
        </Button>
      </div>
    </div>
  );
}
