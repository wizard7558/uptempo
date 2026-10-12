"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { joinWaitlist } from "@/actions/waitlist";

/**
 * Pre-launch waitlist signup. Email is required; name and phone are optional.
 *
 * `source` comes from the page's `?src=` param so QR codes and campaign links
 * can be attributed — it is not user-editable.
 */
export function WaitlistForm({ source }: { source: string | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await joinWaitlist({
        name,
        email,
        phone,
        source: source ?? undefined,
      });
      if (result.success) {
        // A duplicate signup is still a success — don't reveal that the address
        // was already on the list, and don't make a re-submit look broken.
        setSubmitted(true);
      } else if (result.error === "invalid-email") {
        setError("Please enter a valid email address.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="border border-border bg-card p-8 text-center">
        <h2 className="display text-3xl text-foreground">
          You&apos;re on the list
        </h2>
        <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
          We&apos;ll email you the moment your spot opens up. Thank you for your
          patience — we&apos;d rather do this properly than quickly.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 border border-border bg-card p-8"
    >
      <div className="space-y-1">
        <span className="eyebrow">Join the waitlist</span>
        <p className="text-sm font-light text-muted-foreground">
          Email is all we need. The rest just helps us reach you faster.
        </p>
      </div>

      <Field label="Email" htmlFor="waitlist-email">
        <Input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Name (optional)" htmlFor="waitlist-name">
        <Input
          id="waitlist-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Phone (optional)" htmlFor="waitlist-phone">
        <Input
          id="waitlist-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="default"
        
        disabled={isSubmitting}
        className="w-full"
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          "Join the waitlist"
        )}
      </Button>
    </form>
  );
}
