"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { createSingleBusiness } from "@/actions/setup";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  identifyPostHogUser,
  trackClientEvent,
} from "@/lib/analytics/posthog-provider";
import { listVerticals, type VerticalId } from "@/lib/verticals";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

function getDefaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some((timeZone) => timeZone.value === tz)) return tz;
  } catch {
    // fall through
  }
  return "America/New_York";
}

export function SetupForm() {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState<VerticalId | "">("");
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verticals = listVerticals();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!industry) {
      setError("Choose an industry.");
      return;
    }
    setIsSubmitting(true);

    try {
      const result = await createSingleBusiness({
        businessName,
        industry,
        timezone,
        ownerName,
        email,
        password,
      });

      if (result.success) {
        await authClient.signIn.email({
          email,
          password,
          callbackURL: "/onboarding",
        });
        identifyPostHogUser(email, {
          email,
          name: ownerName,
          tenantSlug: result.slug,
          role: "owner",
        });
        trackClientEvent("salon.signup_completed", { slug: result.slug });
        router.push("/onboarding");
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="ownerName" label="Your name" required>
          <Field.Input
            id="ownerName"
            type="text"
            placeholder="Jane Smith"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            autoComplete="name"
          />
        </Field>

        <Field htmlFor="email" label="Email" required>
          <Field.Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>

        <Field htmlFor="password" label="Password" required>
          <Field.Input
            id="password"
            type="password"
            placeholder="Min 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <Field htmlFor="businessName" label="Business name" required>
          <Field.Input
            id="businessName"
            type="text"
            placeholder="Luxe Hair Studio"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Industry</legend>
          {verticals.map((vertical) => (
            <label key={vertical.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="industry"
                value={vertical.id}
                required
                checked={industry === vertical.id}
                onChange={() => setIndustry(vertical.id)}
              />
              {vertical.label}
            </label>
          ))}
        </fieldset>

        <Field htmlFor="timezone" label="Timezone" required>
          <Select value={timezone} onValueChange={setTimezone}>
            <Field.Select id="timezone">
              <SelectValue placeholder="Select timezone" />
            </Field.Select>
            <SelectContent>
              {TIMEZONES.map((timeZone) => (
                <SelectItem key={timeZone.value} value={timeZone.value}>
                  {timeZone.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Button
          type="submit"
          className="w-full"
          variant="default"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create salon account"
          )}
        </Button>
      </form>
    </>
  );
}
