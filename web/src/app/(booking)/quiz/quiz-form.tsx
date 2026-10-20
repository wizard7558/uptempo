"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitQuizResponse } from "@/actions/quiz";
import { cn } from "@/lib/utils";

/**
 * `source` comes from the page's `?src=` param so QR codes and campaign links
 * can be attributed — it is not user-editable.
 */
export function QuizForm({ source }: { source: string | null }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [biggestTimeWaster, setBiggestTimeWaster] = useState("");
  const [automateOneThing, setAutomateOneThing] = useState("");
  const [softwareRating, setSoftwareRating] = useState(0);
  const [favoriteThing, setFavoriteThing] = useState("");
  const [leastFavoriteThing, setLeastFavoriteThing] = useState("");
  const [wishedFeature, setWishedFeature] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await submitQuizResponse({
        name,
        phone,
        email,
        biggestTimeWaster,
        automateOneThing,
        softwareRating: softwareRating || undefined,
        favoriteThing,
        leastFavoriteThing,
        wishedFeature,
        source: source ?? undefined,
      });
      if (result.success) {
        setSubmitted(true);
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
      <div className="rounded-lg border border-border p-6">
        <div className="text-center">
          <h2 className="display text-2xl text-foreground">Thank you</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your feedback helps us build the tools you actually need.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-7">
      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field label="Phone number" htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field
        label="What wastes the most time in your business?"
        htmlFor="biggestTimeWaster"
      >
        <Textarea
          id="biggestTimeWaster"
          value={biggestTimeWaster}
          onChange={(e) => setBiggestTimeWaster(e.target.value)}
        />
      </Field>

      <Field
        label="If you could automate one thing, what would it be?"
        htmlFor="automateOneThing"
      >
        <Textarea
          id="automateOneThing"
          value={automateOneThing}
          onChange={(e) => setAutomateOneThing(e.target.value)}
          placeholder="The one task you'd hand off in a heartbeat"
        />
      </Field>

      <Field label="Rate your current software">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = softwareRating === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={selected}
                aria-label={`${n} out of 5`}
                onClick={() => setSoftwareRating(selected ? 0 : n)}
                className={cn(
                  "size-10 rounded-md border text-sm transition-colors",
                  // Semantic tokens, not var(--ink): the --ink/--line vars
                  // already hold complete hsl() functions, so var(--ink)
                  // nests to hsl(hsl(...)) — invalid CSS the browser drops,
                  // which left selected and unselected rendering identically.
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="What's your favorite thing about it?"
        htmlFor="favoriteThing"
      >
        <Textarea
          id="favoriteThing"
          value={favoriteThing}
          onChange={(e) => setFavoriteThing(e.target.value)}
        />
      </Field>

      <Field
        label="What's your least favorite thing about it?"
        htmlFor="leastFavoriteThing"
      >
        <Textarea
          id="leastFavoriteThing"
          value={leastFavoriteThing}
          onChange={(e) => setLeastFavoriteThing(e.target.value)}
        />
      </Field>

      <Field
        label="If you could have any additional feature, what would it be?"
        htmlFor="wishedFeature"
      >
        <Textarea
          id="wishedFeature"
          value={wishedFeature}
          onChange={(e) => setWishedFeature(e.target.value)}
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
          "Submit"
        )}
      </Button>
    </form>
  );
}
