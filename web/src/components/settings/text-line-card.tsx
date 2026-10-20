"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getTextLine,
  resendTextLineConfirmation,
  submitTextLine,
  turnOffTextLine,
  type TextLineActionResult,
  type TextLineSnapshot,
} from "@/actions/text-line";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/terms/client";

type BusinessType = "SOLE_PROPRIETOR" | "PARTNERSHIP" | "LLC" | "CORPORATION";
type RegistrationDraft = {
  legalBusinessName: string;
  businessType: BusinessType;
  ein: string;
  businessAddress: {
    street: string;
    street2: string;
    city: string;
    state: string;
    postalCode: string;
  };
  website: string;
  owner: {
    firstName: string;
    lastName: string;
    title: string;
    email: string;
    mobile: string;
  };
};

function emptyDraft(): RegistrationDraft {
  return {
    legalBusinessName: "",
    businessType: "SOLE_PROPRIETOR",
    ein: "",
    businessAddress: {
      street: "",
      street2: "",
      city: "",
      state: "",
      postalCode: "",
    },
    website: "",
    owner: {
      firstName: "",
      lastName: "",
      title: "",
      email: "",
      mobile: "",
    },
  };
}

function draftFromSnapshot(snapshot: TextLineSnapshot): RegistrationDraft {
  const draft = emptyDraft();
  if (!snapshot.formDefaults) return draft;
  return {
    ...draft,
    ...snapshot.formDefaults,
    ein: "", // EINs are never returned to the browser or prefilled for retries.
    businessAddress: {
      ...draft.businessAddress,
      ...snapshot.formDefaults.businessAddress,
      street2: snapshot.formDefaults.businessAddress.street2 ?? "",
    },
    owner: { ...draft.owner, ...snapshot.formDefaults.owner },
  };
}

export function TextLineCard({
  initialState,
}: {
  initialState: TextLineSnapshot;
}) {
  const t = useT("settings");
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialState);
  const [draft, setDraft] = useState(() => draftFromSnapshot(initialState));
  const [showForm, setShowForm] = useState(false);
  const [acceptedFee, setAcceptedFee] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isConfirmText =
    snapshot.status === "action_needed" && snapshot.reason === "confirm_text";
  const needsEin = snapshot.status === "action_needed" && snapshot.requiresEin;

  function openForm() {
    setDraft(draftFromSnapshot(snapshot));
    setAcceptedFee(false);
    setError(null);
    setNotice(null);
    setShowForm(true);
  }

  function setAddress(
    field: keyof RegistrationDraft["businessAddress"],
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      businessAddress: { ...current.businessAddress, [field]: value },
    }));
  }

  function setOwner(field: keyof RegistrationDraft["owner"], value: string) {
    setDraft((current) => ({
      ...current,
      owner: { ...current.owner, [field]: value },
    }));
  }

  function showActionError(
    result: Extract<TextLineActionResult, { ok: false }>,
  ) {
    setError(t(`textLine.errors.${result.error}`));
  }

  async function refreshState() {
    const next = await getTextLine();
    if (next) setSnapshot(next);
    router.refresh();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitTextLine({
        legalBusinessName: draft.legalBusinessName,
        ...(draft.ein.trim() ? { ein: draft.ein.trim() } : {}),
        businessType: draft.businessType,
        businessAddress: {
          street: draft.businessAddress.street,
          ...(draft.businessAddress.street2.trim()
            ? { street2: draft.businessAddress.street2 }
            : {}),
          city: draft.businessAddress.city,
          state: draft.businessAddress.state,
          postalCode: draft.businessAddress.postalCode,
        },
        ...(draft.website.trim() ? { website: draft.website.trim() } : {}),
        owner: draft.owner,
      });
      if (!result.ok) {
        showActionError(result);
        return;
      }
      setShowForm(false);
      setNotice(
        result.warning
          ? t("textLine.errors.billing_sync_retryable")
          : t("textLine.saved"),
      );
      await refreshState();
    });
  }

  function handleResend() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await resendTextLineConfirmation();
      if (!result.ok) {
        showActionError(result);
        return;
      }
      setNotice(t("textLine.confirmationResent"));
      await refreshState();
    });
  }

  function handleTurnOff() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await turnOffTextLine();
      if (!result.ok) {
        showActionError(result);
        return;
      }
      setSnapshot((current) => ({
        ...current,
        status: "off",
        canReactivate: Boolean(current.phoneNumber),
      }));
      setNotice(
        result.warning
          ? t("textLine.errors.billing_sync_retryable")
          : t("textLine.turnedOff"),
      );
      router.refresh();
    });
  }

  function handleTurnOn() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await submitTextLine();
      if (!result.ok) {
        showActionError(result);
        return;
      }
      setSnapshot((current) => ({
        ...current,
        status: "active",
        canReactivate: false,
      }));
      setNotice(
        result.warning
          ? t("textLine.errors.billing_sync_retryable")
          : t("textLine.turnedOn"),
      );
      router.refresh();
    });
  }

  const approvedLineState =
    snapshot.status === "active" ||
    snapshot.status === "pending" ||
    (snapshot.status === "off" && snapshot.canReactivate);
  let stateCopy = "";
  if (!snapshot.available && !approvedLineState)
    stateCopy = t("textLine.unavailable");
  else if (snapshot.status === "off" && snapshot.canReactivate) {
    stateCopy = t("textLine.offApproved", {
      phoneNumber: snapshot.phoneNumber ?? "",
    });
  } else if (snapshot.status === "off") stateCopy = t("textLine.offCopy");
  else if (snapshot.status === "shared") stateCopy = t("textLine.sharedCopy");
  else if (snapshot.status === "pending") stateCopy = t("textLine.pendingCopy");
  else if (isConfirmText) {
    stateCopy = t("textLine.confirmTextCopy", {
      mobile: snapshot.mobile ?? "",
    });
  } else if (snapshot.status === "action_needed") {
    stateCopy = snapshot.reasonMessage ?? t("textLine.actionNeededCopy");
  } else if (snapshot.status === "active") {
    stateCopy = t("textLine.activeCopy", {
      phoneNumber: snapshot.phoneNumber ?? "",
    });
  }

  const feeCopy = snapshot.setupFeeExempt
    ? snapshot.setupFeeExemptionReason === "shared"
      ? t("textLine.sharedFee")
      : snapshot.setupFeeExemptionReason === "comped"
        ? t("textLine.compedFee")
        : t("textLine.exemptFee")
    : snapshot.setupFeeAdded
      ? t("textLine.resubmitFee")
      : t("textLine.feeDisclosure");

  return (
    <section aria-labelledby="text-line-title" className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle id="text-line-title">{t("textLine.title")}</CardTitle>
          <CardDescription role="status">{stateCopy}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}

          {!showForm && (snapshot.available || approvedLineState) ? (
            <div className="flex flex-wrap gap-3">
              {snapshot.status === "off" && snapshot.canReactivate ? (
                <Button
                  type="button"
                  onClick={handleTurnOn}
                  disabled={isPending}
                >
                  {isPending ? t("textLine.working") : t("textLine.turnOn")}
                </Button>
              ) : null}
              {snapshot.status === "off" && !snapshot.canReactivate ? (
                <Button type="button" onClick={openForm} disabled={isPending}>
                  {t("textLine.setUp")}
                </Button>
              ) : null}
              {snapshot.status === "shared" ? (
                <Button type="button" onClick={openForm} disabled={isPending}>
                  {t("textLine.setUpFree")}
                </Button>
              ) : null}
              {snapshot.status === "action_needed" && isConfirmText ? (
                <Button
                  type="button"
                  onClick={handleResend}
                  disabled={isPending}
                >
                  {isPending ? t("textLine.working") : t("textLine.sendAgain")}
                </Button>
              ) : null}
              {snapshot.status === "action_needed" && !isConfirmText ? (
                <Button type="button" onClick={openForm} disabled={isPending}>
                  {t("textLine.fixAndResubmit")}
                </Button>
              ) : null}
              {snapshot.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTurnOff}
                  disabled={isPending}
                >
                  {isPending ? t("textLine.working") : t("textLine.turnOff")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {showForm ? (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="text-line-business-name">
                    {t("textLine.fields.legalName")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-business-name"
                    autoComplete="organization"
                    required
                    value={draft.legalBusinessName}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        legalBusinessName: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-business-type">
                    {t("textLine.fields.businessType")}
                  </Label>
                  <select
                    id="text-line-business-type"
                    className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base"
                    value={draft.businessType}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        businessType: event.target.value as BusinessType,
                      }))
                    }
                  >
                    <option value="SOLE_PROPRIETOR">
                      {t("textLine.businessTypes.soleProprietor")}
                    </option>
                    <option value="PARTNERSHIP">
                      {t("textLine.businessTypes.partnership")}
                    </option>
                    <option value="LLC">
                      {t("textLine.businessTypes.llc")}
                    </option>
                    <option value="CORPORATION">
                      {t("textLine.businessTypes.corporation")}
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-ein">
                    {needsEin
                      ? t("textLine.fields.einRequired")
                      : t("textLine.fields.einOptional")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-ein"
                    inputMode="numeric"
                    autoComplete="off"
                    required={needsEin}
                    value={draft.ein}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        ein: event.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("textLine.fields.einHint")}
                  </p>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="text-line-street">
                    {t("textLine.fields.street")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-street"
                    autoComplete="address-line1"
                    required
                    value={draft.businessAddress.street}
                    onChange={(event) =>
                      setAddress("street", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="text-line-street2">
                    {t("textLine.fields.street2")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-street2"
                    autoComplete="address-line2"
                    value={draft.businessAddress.street2}
                    onChange={(event) =>
                      setAddress("street2", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-city">
                    {t("textLine.fields.city")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-city"
                    autoComplete="address-level2"
                    required
                    value={draft.businessAddress.city}
                    onChange={(event) => setAddress("city", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-state">
                    {t("textLine.fields.state")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-state"
                    autoComplete="address-level1"
                    maxLength={2}
                    required
                    value={draft.businessAddress.state}
                    onChange={(event) =>
                      setAddress("state", event.target.value.toUpperCase())
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-postal">
                    {t("textLine.fields.postalCode")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-postal"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    required
                    value={draft.businessAddress.postalCode}
                    onChange={(event) =>
                      setAddress("postalCode", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-website">
                    {t("textLine.fields.website")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-website"
                    type="url"
                    autoComplete="url"
                    value={draft.website}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        website: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="text-line-owner-first">
                    {t("textLine.fields.firstName")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-owner-first"
                    autoComplete="given-name"
                    required
                    value={draft.owner.firstName}
                    onChange={(event) =>
                      setOwner("firstName", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-owner-last">
                    {t("textLine.fields.lastName")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-owner-last"
                    autoComplete="family-name"
                    required
                    value={draft.owner.lastName}
                    onChange={(event) =>
                      setOwner("lastName", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-owner-title">
                    {t("textLine.fields.title")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-owner-title"
                    required
                    value={draft.owner.title}
                    onChange={(event) => setOwner("title", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="text-line-owner-email">
                    {t("textLine.fields.email")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-owner-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={draft.owner.email}
                    onChange={(event) => setOwner("email", event.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="text-line-owner-mobile">
                    {t("textLine.fields.mobile")}
                  </Label>
                  <Input
                    className="h-11"
                    id="text-line-owner-mobile"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={draft.owner.mobile}
                    onChange={(event) => setOwner("mobile", event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm">{feeCopy}</p>
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={acceptedFee}
                    onChange={(event) => setAcceptedFee(event.target.checked)}
                  />
                  <span>{t("textLine.fields.feeAgreement")}</span>
                </label>
                <a
                  className="text-sm underline underline-offset-4"
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("textLine.privacy")}
                </a>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={isPending || !acceptedFee}>
                  {isPending ? t("textLine.working") : t("textLine.submit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  disabled={isPending}
                >
                  {t("textLine.cancel")}
                </Button>
              </div>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
