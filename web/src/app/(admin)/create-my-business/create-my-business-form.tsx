"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Circle, Loader2, ArrowLeft } from "lucide-react";
import {
  createAdditionalSalonAsOwner,
  checkSlugAvailability,
} from "@/actions/onboarding";
import { getBaseUrl } from "@/lib/utils";
import { useT } from "@/lib/terms/client";
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

function defaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some((t) => t.value === tz)) return tz;
  } catch {
    /* ignore */
  }
  return "America/New_York";
}

export function CreateMyBusinessForm() {
  const t = useT("business");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [salonName, setSalonName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [industry, setIndustry] = useState<VerticalId | null>(null);
  const onboarding = useT("onboarding");

  const base = getBaseUrl().replace(/^https?:\/\//, "");

  const checkSlug = useCallback(async (value: string) => {
    if (!value || value.length < 3) {
      setSlugStatus("idle");
      setSlugError(null);
      return;
    }
    setSlugStatus("checking");
    const result = await checkSlugAvailability(value);
    if (result.available) {
      setSlugStatus("available");
      setSlugError(null);
    } else {
      setSlugStatus(
        result.error?.includes("already taken") ? "taken" : "invalid",
      );
      setSlugError(result.error ?? "Invalid slug");
    }
  }, []);

  useEffect(() => {
    if (!slug || slug.length < 3) {
      setSlugStatus("idle");
      return;
    }
    const timer = setTimeout(() => checkSlug(slug), 300);
    return () => clearTimeout(timer);
  }, [slug, checkSlug]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      if (!industry) return;
      const result = await createAdditionalSalonAsOwner({
        salonName,
        slug,
        timezone,
        industry,
      });
      if (result.success) {
        router.push("/onboarding");
        router.refresh();
      } else {
        setFormError(result.error);
      }
    });
  }

  if (!industry) {
    return <IndustryPicker onSelect={setIndustry} />;
  }

  const chosen =
    industry === "general" ? onboarding("industry.somethingElse") : VERTICALS[industry].label;

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>{t("createForm.title")}</CardTitle>
        <CardDescription>
          {t("createForm.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{chosen}</p>
            <Button type="button" variant="outline" onClick={() => setIndustry(null)}>
              {onboarding("industry.change")}
            </Button>
          </div>
          {formError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-salon-name">{t("createForm.nameLabel")}</Label>
            <Input
              id="new-salon-name"
              placeholder="Your studio name"
              value={salonName}
              onChange={(e) => setSalonName(e.target.value)}
              required
              autoComplete="organization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-salon-slug">Booking URL</Label>
            <div className="flex items-center gap-2">
              <Input
                id="new-salon-slug"
                placeholder="your-studio"
                value={slug}
                onChange={(e) =>
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                required
                minLength={3}
                className="flex-1"
              />
              <div className="flex w-5 shrink-0 justify-center">
                {slugStatus === "checking" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {slugStatus === "available" && (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                {(slugStatus === "taken" || slugStatus === "invalid") && (
                  <Circle className="h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {slug ? `${base}/book/${slug}` : `${base}/book/your-studio`}
            </p>
            {slugError && (
              <p className="text-xs text-destructive">{slugError}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-salon-tz">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="new-salon-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" asChild type="button" className="w-fit">
              <Link href="/schedule">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !salonName.trim() ||
                slugStatus !== "available" ||
                slug.length < 3
              }
              className="sm:min-w-40"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Continue to setup
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
