"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/terms/client";
import { WorkingHoursPageClient } from "@/app/(admin)/settings/hours/client";
import { PolicyForm } from "@/components/settings/policy-form";
import { BrandingSettingsForm } from "@/app/(admin)/settings/branding/client";
import {
  renameOnboardingForm,
  setOnboardingServicesActive,
} from "@/actions/onboarding";
import type { OnboardingReview } from "@/lib/onboarding/pack-seed";
import type { DaySchedule } from "@/lib/scheduling/week";
import type { PolicyInitial } from "./policies-step";
import type { BrandingSettingsData } from "./branding-step";
import { toast } from "sonner";

function money(cents: number | null): string {
  if (cents == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function ReviewStep({
  catalog,
  staff,
  initialHours,
  locations,
  policyInitial,
  brandingSettings,
  onContinue,
  onBack,
  pending,
}: {
  catalog: OnboardingReview;
  staff: Array<{ id: string; name: string }>;
  initialHours: DaySchedule[];
  locations: Array<{ id: string; name: string; address: string | null }>;
  policyInitial: PolicyInitial | null;
  brandingSettings: BrandingSettingsData | null;
  onContinue: () => void;
  onBack: () => void;
  pending: boolean;
}) {
  const t = useT("onboarding");
  const router = useRouter();
  const [editing, setEditing] = useState<
    "services" | "hours" | "policies" | "forms" | "theme" | null
  >(null);
  const [formNames, setFormNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(catalog.forms.map((form) => [form.id, form.name])),
  );
  const [, startTransition] = useTransition();

  function toggleService(id: string, next: boolean) {
    const active = catalog.services.filter((service) => service.active).map((service) => service.id);
    const ids = next
      ? [...new Set([...active, id])]
      : active.filter((serviceId) => serviceId !== id);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await setOnboardingServicesActive(ids);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function saveForm(id: string) {
    startTransition(async () => {
      const result = await renameOnboardingForm(id, formNames[id] ?? "");
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  const serviceSummary = catalog.services
    .map((service) => {
      const price = money(service.priceCents);
      const bits = [service.name, `${service.minutes} min`];
      if (price) bits.push(price);
      return bits.join(", ");
    })
    .join(". ");

  const themeSummary = catalog.theme
    ? `${catalog.theme.brandColor}, ${catalog.theme.fontPairing}, ${catalog.theme.cornerStyle}, ${catalog.theme.density}, ${catalog.theme.colorMode}`
    : t("review.empty");

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">{t("review.title")}</h2>

      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">{t("review.services")}</h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(editing === "services" ? null : "services")}
          >
            {editing === "services"
              ? t("review.done")
              : t("review.edit", { group: t("review.services") })}
          </Button>
        </div>
        {editing === "services" ? (
          <div className="space-y-2">
            {catalog.services.map((service) => (
              <label key={service.id} className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox
                  checked={service.active}
                  onCheckedChange={(checked) => toggleService(service.id, checked === true)}
                />
                <span>
                  {service.name}, {service.minutes} min
                  {service.priceCents != null ? `, ${money(service.priceCents)}` : ""}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm">{serviceSummary || t("review.empty")}</p>
        )}
      </section>

      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">{t("review.hours")}</h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(editing === "hours" ? null : "hours")}
          >
            {editing === "hours"
              ? t("review.done")
              : t("review.edit", { group: t("review.hours") })}
          </Button>
        </div>
        {editing === "hours" ? (
          staff.length > 0 ? (
            <WorkingHoursPageClient
              staff={staff}
              initialHours={initialHours}
              initialStaffId={staff[0].id}
              locations={locations}
            />
          ) : (
            <p className="text-sm">{t("wizard.noStaffProfile")}</p>
          )
        ) : (
          <p className="text-sm">{catalog.hoursSummary}</p>
        )}
      </section>

      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">{t("review.policies")}</h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(editing === "policies" ? null : "policies")}
          >
            {editing === "policies"
              ? t("review.done")
              : t("review.edit", { group: t("review.policies") })}
          </Button>
        </div>
        {editing === "policies" && policyInitial ? (
          <PolicyForm
            initialPolicy={policyInitial}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : (
          <p className="text-sm">{catalog.policyText || t("review.empty")}</p>
        )}
      </section>

      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">{t("review.forms")}</h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(editing === "forms" ? null : "forms")}
          >
            {editing === "forms"
              ? t("review.done")
              : t("review.edit", { group: t("review.forms") })}
          </Button>
        </div>
        {editing === "forms" ? (
          <div className="space-y-3">
            {catalog.forms.map((form) => (
              <div key={form.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`form-${form.id}`}>{t("review.forms")}</Label>
                  <Input
                    id={`form-${form.id}`}
                    value={formNames[form.id] ?? form.name}
                    onChange={(event) =>
                      setFormNames((prev) => ({ ...prev, [form.id]: event.target.value }))
                    }
                  />
                </div>
                <Button type="button" variant="outline" onClick={() => saveForm(form.id)}>
                  {t("review.save")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm">
            {catalog.forms.map((form) => form.name).join(". ") || t("review.empty")}
          </p>
        )}
      </section>

      <section className="space-y-3 pb-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium">{t("review.theme")}</h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(editing === "theme" ? null : "theme")}
          >
            {editing === "theme"
              ? t("review.done")
              : t("review.edit", { group: t("review.theme") })}
          </Button>
        </div>
        {editing === "theme" && brandingSettings ? (
          <BrandingSettingsForm
            initialSettings={brandingSettings}
            onSaved={() => setEditing(null)}
          />
        ) : (
          <p className="text-sm">{themeSummary}</p>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {t("wizard.back")}
        </Button>
        <Button type="button" onClick={onContinue} disabled={pending}>
          {t("review.continue")}
        </Button>
      </div>
    </div>
  );
}
