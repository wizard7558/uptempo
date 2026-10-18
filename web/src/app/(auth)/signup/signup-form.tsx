"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { createSalonAccount } from "@/actions/onboarding";
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
import { TermsProvider, useT } from "@/lib/terms/client";
import { IndustryPicker } from "@/components/onboarding/industry-picker";
import { VERTICALS, type VerticalId } from "@/lib/verticals";

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

function AccountFields({
  industry,
  onChangeIndustry,
}: {
  industry: VerticalId;
  onChangeIndustry: () => void;
}) {
  const t = useT("onboarding");
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [salonName, setSalonName] = useState("");
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen =
    industry === "general" ? t("industry.somethingElse") : VERTICALS[industry].label;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await createSalonAccount({
        salonName,
        timezone,
        ownerName,
        email,
        password,
        industry,
      });

      if (result.success) {
        await authClient.signIn.email({ email, password });
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
    } catch (err) {
      if (err instanceof Error && err.name === "AuthError") throw err;
      setError(t("account.genericError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{chosen}</p>
        <Button type="button" variant="outline" onClick={onChangeIndustry}>
          {t("industry.change")}
        </Button>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="ownerName" label={t("account.yourName")} required>
          <Field.Input
            id="ownerName"
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            autoComplete="name"
          />
        </Field>

        <Field htmlFor="email" label={t("account.email")} required>
          <Field.Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>

        <Field htmlFor="password" label={t("account.password")} required>
          <Field.Input
            id="password"
            type="password"
            placeholder={t("account.passwordHint")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <Field htmlFor="salonName" label={t("account.placeName")} required>
          <Field.Input
            id="salonName"
            type="text"
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
            required
          />
        </Field>

        <Field htmlFor="timezone" label={t("account.timezone")} required>
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

        <Button type="submit" className="w-full" variant="default" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("account.submitting")}
            </>
          ) : (
            t("account.submit")
          )}
        </Button>
      </form>
    </>
  );
}

export function SignupForm({ initialIndustry = null }: { initialIndustry?: VerticalId | null }) {
  const [industry, setIndustry] = useState<VerticalId | null>(initialIndustry);
  const terms = VERTICALS[industry ?? "general"].terms;
  return (
    <TermsProvider terms={terms}>
      {industry == null ? (
        <IndustryPicker onSelect={setIndustry} />
      ) : (
        <AccountFields industry={industry} onChangeIndustry={() => setIndustry(null)} />
      )}
    </TermsProvider>
  );
}
