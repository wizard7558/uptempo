"use client";

import { useT } from "@/lib/terms/client";
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Circle, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  checkSlugAvailability,
  launchSalon,
  markOnboardingStepComplete,
  saveBusinessDetails,
  setupSalonForOAuthUser,
} from "@/actions/onboarding";
import type { LaunchPrereq } from "@/lib/onboarding/state";
import type { DaySchedule } from "@/lib/scheduling/week";
import type { OnboardingReview } from "@/lib/onboarding/pack-seed";
import { IndustryPicker } from "@/components/onboarding/industry-picker";
import { VERTICALS, type VerticalId } from "@/lib/verticals";
import { PaymentsStep, type ConnectStatusInfo } from "./payments-step";
import { ReviewStep } from "./review-step";
import type { PolicyInitial } from "./policies-step";
import type { BrandingSettingsData } from "./branding-step";

interface OnboardingSteps {
  profile: boolean;
  services: boolean;
  hours: boolean;
  policies: boolean;
  stripe: boolean;
  stripeSkipped: boolean;
  branding: boolean;
  launched: boolean;
}

type StepId = "business" | "review" | "payments" | "publish";

const STEPS: StepId[] = ["business", "review", "payments", "publish"];

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

function rethrowAuth(err: unknown): void {
  if (err instanceof Error && err.name === "AuthError") throw err;
}

export function OnboardingWizard({
  steps,
  needsProfile,
  tenantSlug,
  staff,
  initialHours,
  locations,
  policyInitial,
  brandingSettings,
  connectStatus,
  stripeSetupComplete,
  catalog,
  selfHosted = null,
  homePath = "/schedule",
}: {
  steps: OnboardingSteps | null;
  needsProfile: boolean;
  tenantSlug: string | null;
  staff: Array<{ id: string; name: string }>;
  initialHours: DaySchedule[];
  locations: Array<{ id: string; name: string; address: string | null }>;
  policyInitial: PolicyInitial | null;
  brandingSettings: BrandingSettingsData | null;
  connectStatus: ConnectStatusInfo;
  stripeSetupComplete: boolean;
  catalog: OnboardingReview | null;
  selfHosted?: { configured: boolean; webhookUrl: string } | null;
  homePath?: string;
}) {
  const t = useT("onboarding");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function initialStep(): StepId {
    if (stripeSetupComplete) return "payments";
    if (needsProfile || !catalog?.address) return "business";
    if (!steps?.policies) return "review";
    if (!steps.stripe && !steps.stripeSkipped) return "payments";
    return "publish";
  }

  const [step, setStep] = useState<StepId>(initialStep);
  const [published, setPublished] = useState(false);
  const [origin, setOrigin] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  const [industry, setIndustry] = useState<VerticalId | null>(null);
  const [profileSalonName, setProfileSalonName] = useState("");
  const [profileSlug, setProfileSlug] = useState("");
  const [profileTimezone, setProfileTimezone] = useState("America/New_York");
  const [profileSlugStatus, setProfileSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [profileSlugError, setProfileSlugError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [salonName, setSalonName] = useState(catalog?.businessName ?? "");
  const [phone, setPhone] = useState(catalog?.phone ?? "");
  const [address, setAddress] = useState(catalog?.address ?? "");
  const [businessError, setBusinessError] = useState<string | null>(null);

  const effectiveSlug = tenantSlug ?? profileSlug;
  const bookingPath = `/book/${effectiveSlug}`;
  const bookingUrl = origin ? `${origin}${bookingPath}` : bookingPath;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!published || !bookingUrl.startsWith("http")) return;
    let cancelled = false;
    void import("qrcode").then((mod) =>
      mod.default.toDataURL(bookingUrl, { margin: 1, width: 240 }).then((data) => {
        if (!cancelled) setQr(data);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [published, bookingUrl]);

  const checkProfileSlug = useCallback(async (value: string) => {
    if (!value || value.length < 3) {
      setProfileSlugStatus("idle");
      setProfileSlugError(null);
      return;
    }
    setProfileSlugStatus("checking");
    const result = await checkSlugAvailability(value);
    if (result.available) {
      setProfileSlugStatus("available");
      setProfileSlugError(null);
    } else {
      setProfileSlugStatus(result.error?.includes("already taken") ? "taken" : "invalid");
      setProfileSlugError(result.error ?? "Invalid slug");
    }
  }, []);

  useEffect(() => {
    if (!profileSlug || profileSlug.length < 3) {
      setProfileSlugStatus("idle");
      return;
    }
    const timer = setTimeout(() => void checkProfileSlug(profileSlug), 300);
    return () => clearTimeout(timer);
  }, [profileSlug, checkProfileSlug]);

  function handleProfileSubmit() {
    if (!industry) return;
    setProfileError(null);
    startTransition(async () => {
      try {
        const result = await setupSalonForOAuthUser({
          salonName: profileSalonName,
          slug: profileSlug,
          timezone: profileTimezone,
          industry,
        });
        if (!result.success) {
          setProfileError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        rethrowAuth(err);
        setProfileError(err instanceof Error ? err.message : t("account.genericError"));
      }
    });
  }

  function handleBusinessSubmit() {
    setBusinessError(null);
    startTransition(async () => {
      try {
        const result = await saveBusinessDetails({
          salonName,
          phone,
          address,
        });
        if (!result.success) {
          setBusinessError(result.error);
          return;
        }
        setStep("review");
        router.refresh();
      } catch (err) {
        rethrowAuth(err);
        setBusinessError(err instanceof Error ? err.message : t("account.genericError"));
      }
    });
  }

  function handleReviewContinue() {
    startTransition(async () => {
      try {
        const result = await markOnboardingStepComplete("policies");
        if (!result.success) {
          toast.error(result.error ?? t("account.genericError"));
          return;
        }
        setStep("payments");
      } catch (err) {
        rethrowAuth(err);
        toast.error(err instanceof Error ? err.message : t("account.genericError"));
      }
    });
  }

  function handlePublish() {
    startTransition(async () => {
      try {
        const result = await launchSalon();
        if (result.success) {
          setPublished(true);
          toast.success(t("wizard.live"));
          return;
        }
        toast.error(result.error);
        const first = result.missing?.[0];
        if (first) {
          const jump: Record<LaunchPrereq, StepId> = {
            services: "review",
            hours: "review",
            policies: "review",
            payments: "payments",
          };
          setStep(jump[first]);
        }
      } catch (err) {
        rethrowAuth(err);
        toast.error(err instanceof Error ? err.message : t("account.genericError"));
      }
    });
  }

  const stepLabel: Record<StepId, string> = {
    business: t("wizard.stepBusiness"),
    review: t("wizard.stepReview"),
    payments: t("wizard.stepPayments"),
    publish: t("wizard.stepPublish"),
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {STEPS.map((id, index) => {
          const current = step === id;
          const done = STEPS.indexOf(step) > index || (id === "publish" && published);
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (done || STEPS.indexOf(id) <= STEPS.indexOf(step)) setStep(id);
              }}
              aria-label={`${index + 1}. ${stepLabel[id]}`}
              className="inline-flex min-h-11 items-center gap-2 px-2 text-sm disabled:opacity-40"
            >
              {done ? (
                <CheckCircle2 className="size-5 text-green-600" />
              ) : (
                <Circle className={`size-5 ${current ? "text-primary" : "text-muted-foreground"}`} />
              )}
              <span className={current ? "font-medium" : "text-muted-foreground"}>{stepLabel[id]}</span>
            </button>
          );
        })}
      </div>

      {step === "business" && needsProfile && (
        <div className="space-y-4">
          {industry == null ? (
            <IndustryPicker onSelect={setIndustry} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  {industry === "general"
                    ? t("industry.somethingElse")
                    : VERTICALS[industry].label}
                </p>
                <Button type="button" variant="outline" onClick={() => setIndustry(null)}>
                  {t("industry.change")}
                </Button>
              </div>
              {profileError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {profileError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="profile-salon-name">{t("wizard.nameLabel")}</Label>
                <Input
                  id="profile-salon-name"
                  value={profileSalonName}
                  onChange={(event) => setProfileSalonName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-slug">{t("wizard.bookingUrl")}</Label>
                <Input
                  id="profile-slug"
                  value={profileSlug}
                  onChange={(event) =>
                    setProfileSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  required
                />
                {profileSlugError && <p className="text-sm text-destructive">{profileSlugError}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-timezone">{t("wizard.timezone")}</Label>
                <Select value={profileTimezone} onValueChange={setProfileTimezone}>
                  <SelectTrigger id="profile-timezone" className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((zone) => (
                      <SelectItem key={zone.value} value={zone.value}>
                        {zone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                className="w-full"
                onClick={handleProfileSubmit}
                disabled={isPending || !profileSalonName || profileSlugStatus !== "available"}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("wizard.continue")}
              </Button>
            </div>
          )}
        </div>
      )}

      {step === "business" && !needsProfile && (
        <div className="space-y-4">
          <h2 className="text-xl font-medium">{t("wizard.businessTitle")}</h2>
          {businessError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {businessError}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="business-name">{t("wizard.nameLabel")}</Label>
            <Input
              id="business-name"
              value={salonName}
              onChange={(event) => setSalonName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-phone">{t("wizard.phone")}</Label>
            <Input
              id="business-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-address">{t("wizard.address")}</Label>
            <Input
              id="business-address"
              autoComplete="street-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
            />
          </div>
          <Button
            type="button"
            onClick={handleBusinessSubmit}
            disabled={isPending || !salonName.trim() || !phone.trim() || !address.trim()}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("wizard.continue")}
          </Button>
        </div>
      )}

      {step === "review" && catalog && (
        <ReviewStep
          catalog={catalog}
          staff={staff}
          initialHours={initialHours}
          locations={locations}
          policyInitial={policyInitial}
          brandingSettings={brandingSettings}
          onContinue={handleReviewContinue}
          onBack={() => setStep("business")}
          pending={isPending}
        />
      )}

      {step === "payments" && (
        <PaymentsStep
          initialStatus={connectStatus}
          stripeSetupComplete={stripeSetupComplete}
          selfHosted={selfHosted}
          onMarkComplete={() => {}}
          onContinue={() => setStep("publish")}
          onBack={() => setStep("review")}
        />
      )}

      {step === "publish" && (
        <div className="space-y-6">
          <h2 className="text-xl font-medium">{t("publish.title")}</h2>
          {published ? (
            <div className="space-y-4">
              <p className="text-sm">{t("wizard.live")}</p>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("publish.link")}</p>
                <a
                  data-testid="booking-link"
                  href={bookingPath}
                  className="inline-flex min-h-11 items-center break-all text-sm underline"
                >
                  {bookingUrl}
                </a>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(bookingUrl);
                  toast.success(t("publish.copied"));
                }}
              >
                <Copy className="size-4" />
                {t("publish.copy")}
              </Button>
              {qr && (
                <img src={qr} alt={t("publish.qr")} width={240} height={240} />
              )}
              <Button asChild className="w-full">
                <Link href={homePath}>{t("publish.open")}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">{t("publish.help")}</p>
              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="outline" onClick={() => setStep("payments")}>
                  {t("wizard.back")}
                </Button>
                <Button type="button" onClick={handlePublish} disabled={isPending}>
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("publish.button")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
