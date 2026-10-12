"use client";

import { useState, type ReactNode } from "react";
import { CameraIcon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { ProgressBar } from "@/components/booking-public/progress-bar";
import { DetailsStep } from "@/components/booking-public/details-step";
import { useT } from "@/lib/terms/client";
import {
  buildAnswersSchema,
  dollarsToCents,
  type RequestFieldDef,
} from "@/lib/requests/fields";
import {
  removeRequestPhoto,
  submitBookingRequest,
  uploadRequestPhoto,
} from "@/actions/requests-public";
import { checkPostalCodePublic } from "@/actions/on-site";

const STEPS = ["service", "describe", "details", "send"] as const;
type RequestStep = (typeof STEPS)[number];
type DayPart = "morning" | "afternoon" | "evening";

const PARTS: DayPart[] = ["morning", "afternoon", "evening"];
const EMPTY_ADDRESS = { line1: "", line2: "", city: "", region: "", postalCode: "" };
const PREFERRED_DAYS: RequestFieldDef = {
  key: "preferred_days",
  kind: "days",
  required: false,
};

type Photo = { id: string; name: string; previewUrl: string };
type Client = { clientId: string; clientName: string };

export interface RequestWizardProps {
  salonId: string;
  salonName: string;
  hasSalonLogo: boolean;
  clientSession: { clientId: string; clientName: string } | null;
  fields: RequestFieldDef[];
  services: { id: string; name: string }[];
  staff: { id: string; displayName: string }[];
  /** Nobody is taking requests right now. */
  booksClosed?: boolean;
  /** When requests next open, already formatted (null = nothing scheduled). */
  booksClosedDate?: string | null;
}

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stepIndex(step: RequestStep): number {
  return STEPS.indexOf(step);
}

function withStep(completed: RequestStep[], step: RequestStep): RequestStep[] {
  return completed.includes(step) ? completed : [...completed, step];
}

/** Step 2 always offers preferred days, once, even when the pack omits them. */
function describeFields(fields: RequestFieldDef[]): RequestFieldDef[] {
  if (fields.some((field) => field.kind === "days")) return fields;
  return [...fields, PREFERRED_DAYS];
}

export function RequestWizard({
  salonId,
  salonName,
  hasSalonLogo,
  clientSession,
  fields,
  services,
  staff,
  booksClosed = false,
  booksClosedDate = null,
}: RequestWizardProps) {
  const t = useT("requests");
  const shownFields = describeFields(fields);
  const [step, setStep] = useState<RequestStep>("service");
  const [completed, setCompleted] = useState<RequestStep[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [days, setDays] = useState<number[]>([]);
  const [parts, setParts] = useState<DayPart[]>([]);
  const [client, setClient] = useState<Client | null>(clientSession);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** On-site businesses: a plain sentence when they don't travel to the ZIP code just typed. */
  const [zipNote, setZipNote] = useState<string | null>(null);

  const labelFor = (key: string) =>
    key in LABELLED ? t(`fields.${key}.label`) : humanize(key);
  const stepLabels = [
    t("stepService"),
    t("stepDescribe"),
    t("stepDetails"),
    t("stepSend"),
  ];

  const setAnswer = (key: string, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));
  const setAddress = (part: string, value: string) =>
    setAnswers((prev) => ({
      ...prev,
      address: { ...EMPTY_ADDRESS, ...(prev.address as object | undefined), [part]: value },
    }));

  function validate(): boolean {
    const result = buildAnswersSchema(shownFields).safeParse(answers);
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) next[String(issue.path[0])] = t("required");
    setErrors(next);
    return false;
  }

  function advance() {
    const next = STEPS[stepIndex(step) + 1];
    if (!next) return;
    if (step === "describe" && !validate()) return;
    setCompleted((prev) => withStep(prev, step));
    setStep(next);
  }

  function goTo(target: RequestStep) {
    const from = stepIndex(step);
    const to = stepIndex(target);
    if (to > from && !completed.includes(target)) return;
    if (step === "describe" && to > stepIndex("describe") && !validate()) return;
    setStep(target);
  }

  async function addFiles(def: RequestFieldDef, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    const max = def.maxPhotos ?? 5;
    let have = (photos[def.key] ?? []).length;
    for (const file of Array.from(files)) {
      if (have >= max) break;
      const form = new FormData();
      form.set("file", file);
      const res = await uploadRequestPhoto(form);
      if (!res.success) {
        setUploadError(res.error);
        break;
      }
      setPhotos((prev) => ({
        ...prev,
        [def.key]: [
          ...(prev[def.key] ?? []),
          { id: res.id, name: res.name, previewUrl: URL.createObjectURL(file) },
        ],
      }));
      have += 1;
    }
    setUploading(false);
  }

  async function removePhoto(key: string, id: string) {
    await removeRequestPhoto(id);
    setPhotos((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((p) => p.id !== id) }));
  }

  async function send() {
    setSending(true);
    setSendError(null);
    const attachmentIds = Object.values(photos).flatMap((list) => list.map((p) => p.id));
    const res = await submitBookingRequest({
      serviceId: serviceId || null,
      staffId: staffId || null,
      answers,
      preferredWindows:
        days.length || parts.length
          ? [{ days, parts }]
          : [],
      attachmentIds,
    });
    setSending(false);
    if (res.success) setSent(true);
    else setSendError(res.error);
  }

  function reviewValue(def: RequestFieldDef): string {
    const v = answers[def.key];
    if (def.kind === "photos") return t("photoCount", { count: (photos[def.key] ?? []).length, max: def.maxPhotos ?? 5 });
    if (def.kind === "days") {
      return [...days.map((d) => t(`fields.days.d${d}`)), ...parts.map((p) => t(`fields.preferred_days.${p}`))].join(", ");
    }
    if (def.kind === "select" && typeof v === "string") return v ? t(`fields.${def.key}.options.${v}`) : "";
    if (def.kind === "money" && typeof v === "string") {
      const cents = dollarsToCents(v);
      return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
    }
    if (def.kind === "address" && v && typeof v === "object") {
      const a = v as Record<string, string>;
      return [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(", ");
    }
    return typeof v === "string" ? v : "";
  }

  const header = hasSalonLogo ? (
    <h1 className="sr-only">{salonName}</h1>
  ) : (
    <div className="text-center">
      <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{salonName}</h1>
    </div>
  );

  if (booksClosed) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-2 border border-[var(--line)] bg-[var(--ivory-raised)] p-6 text-center">
          <h2 className="display text-3xl text-[var(--ink)]">{t("booksClosedTitle")}</h2>
          <p className="text-sm text-[var(--ink)]">
            {booksClosedDate
              ? t("booksClosedBody", { date: booksClosedDate })
              : t("booksClosedNoDate")}
          </p>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="space-y-6">
        {header}
        <div className="space-y-2 border border-[var(--line)] bg-[var(--ivory-raised)] p-6 text-center">
          <h2 className="display text-3xl text-[var(--ink)]">{t("sentTitle")}</h2>
          <p className="text-sm text-[var(--ink)]">{t("sentBody")}</p>
        </div>
      </div>
    );
  }

  const serviceName = services.find((service) => service.id === serviceId)?.name ?? t("serviceNotSure");
  const staffName = staff.find((member) => member.id === staffId)?.displayName ?? t("staffAny");

  return (
    <div className="space-y-6">
      {header}
      <ProgressBar
        steps={stepLabels}
        stepKeys={[...STEPS]}
        currentStep={stepIndex(step)}
        completedSteps={new Set(completed)}
        onStepClick={(index) => {
          const target = STEPS[index];
          if (target) goTo(target);
        }}
      />

      {stepIndex(step) > 0 && (
        <button
          type="button"
          onClick={() => {
            const previous = STEPS[stepIndex(step) - 1];
            if (previous) goTo(previous);
          }}
          className="inline-flex min-h-11 items-center gap-1 text-[13px] text-[var(--ink)] underline"
        >
          <span aria-hidden>←</span>
          {t("back")}
        </button>
      )}

      {step === "service" && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            advance();
          }}
        >
          <div className="space-y-1">
            <h2 className="display text-3xl text-[var(--ink)]">{t("serviceTitle")}</h2>
            <p className="text-[13px] text-[var(--ink)]">{t("serviceHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-service">{t("serviceLabel")}</Label>
            <NativeSelect id="req-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">{t("serviceNotSure")}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-staff">{t("staffLabel")}</Label>
            <NativeSelect id="req-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{t("staffAny")}</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="button" variant="default" className="min-h-11 w-full" onClick={() => advance()}>
            {t("continue")}
          </Button>
        </form>
      )}

      {step === "describe" && (
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            advance();
          }}
        >
          <div className="space-y-1">
            <h2 className="display text-3xl text-[var(--ink)]">{t("describeTitle")}</h2>
            <p className="text-[13px] text-[var(--ink)]">{t("describeHint")}</p>
          </div>

          {shownFields.map((def) => renderField(def))}

          <Button
            type="button"
            variant="default"
            className="min-h-11 w-full"
            disabled={uploading}
            onClick={() => advance()}
          >
            {t("continue")}
          </Button>
        </form>
      )}

      {step === "details" && (
        <DetailsStep
          salonId={salonId}
          clientId={client?.clientId ?? null}
          clientName={client?.clientName ?? null}
          onComplete={(clientId, clientName) => {
            setClient({ clientId, clientName });
            advance();
          }}
          onContinue={advance}
          onNotYou={() => {
            void fetch("/api/booking/clear-session", { method: "POST" });
            setClient(null);
          }}
        />
      )}

      {step === "send" && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="display text-3xl text-[var(--ink)]">{t("sendTitle")}</h2>
            <p className="text-sm text-[var(--ink)]">{t("sendBody")}</p>
          </div>
          <dl className="divide-y divide-[var(--line)] border border-[var(--line)]">
            <div className="grid gap-1 p-3 sm:grid-cols-3">
              <dt className="text-sm font-medium">{t("serviceLabel")}</dt>
              <dd className="text-sm sm:col-span-2">{serviceName}</dd>
            </div>
            <div className="grid gap-1 p-3 sm:grid-cols-3">
              <dt className="text-sm font-medium">{t("staffLabel")}</dt>
              <dd className="text-sm sm:col-span-2">{staffName}</dd>
            </div>
            {shownFields.map((def) => (
              <div key={def.key} className="grid gap-1 p-3 sm:grid-cols-3">
                <dt className="text-sm font-medium">{labelFor(def.key)}</dt>
                <dd className="text-sm sm:col-span-2">{reviewValue(def)}</dd>
              </div>
            ))}
          </dl>
          {sendError && (
            <p role="alert" className="text-sm text-destructive">
              {sendError}
            </p>
          )}
          <Button
            type="button"
            variant="default"
            className="h-auto min-h-11 w-full whitespace-normal py-3 text-center"
            disabled={sending}
            onClick={() => void send()}
          >
            <SendIcon aria-hidden />
            {sending ? t("sending") : t("send")}
          </Button>
        </div>
      )}
    </div>
  );

  function renderField(def: RequestFieldDef): ReactNode {
    const id = `req-${def.key}`;
    const label = labelFor(def.key);
    const hasHint = def.key in HINTED;
    const err = errors[def.key];
    const field = (control: ReactNode) => (
      <div className="space-y-2" key={def.key}>
        <Label htmlFor={id}>{label}</Label>
        {hasHint && <p className="text-[13px] text-[var(--ink-soft)]">{t(`fields.${def.key}.hint`)}</p>}
        {control}
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
      </div>
    );
    switch (def.kind) {
      case "text":
        return field(
          <Input
            id={id}
            className="h-11"
            value={(answers[def.key] as string) ?? ""}
            onChange={(e) => setAnswer(def.key, e.target.value)}
            aria-invalid={Boolean(err)}
          />,
        );
      case "textarea":
        return field(
          <Textarea
            id={id}
            rows={5}
            value={(answers[def.key] as string) ?? ""}
            onChange={(e) => setAnswer(def.key, e.target.value)}
            aria-invalid={Boolean(err)}
          />,
        );
      case "select":
        return field(
          <NativeSelect
            id={id}
            value={(answers[def.key] as string) ?? ""}
            onChange={(e) => setAnswer(def.key, e.target.value)}
            aria-invalid={Boolean(err)}
          >
            <option value="">{t("chooseOne")}</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>
                {t(`fields.${def.key}.options.${o}`)}
              </option>
            ))}
          </NativeSelect>,
        );
      case "money":
        return field(
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-base">$</span>
            <Input
              id={id}
              className="h-11"
              inputMode="decimal"
              value={(answers[def.key] as string) ?? ""}
              onChange={(e) => setAnswer(def.key, e.target.value)}
              aria-invalid={Boolean(err)}
            />
          </div>,
        );
      case "photos": {
        const list = photos[def.key] ?? [];
        const max = def.maxPhotos ?? 5;
        return (
          <div className="space-y-2" key={def.key}>
            <Label htmlFor={id}>{label}</Label>
            {hasHint && <p className="text-[13px] text-[var(--ink-soft)]">{t(`fields.${def.key}.hint`)}</p>}
            <div className="relative inline-block rounded-lg focus-within:ring-[3px] focus-within:ring-ring/50">
              <Button type="button" variant="outline" className="h-11 min-h-11" disabled={uploading || list.length >= max} tabIndex={-1}>
                <CameraIcon aria-hidden />
                {uploading ? t("uploading") : t("addPhotos")}
              </Button>
              <input
                id={id}
                type="file"
                accept="image/*"
                multiple
                aria-label={t("addPhotos")}
                disabled={uploading || list.length >= max}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => {
                  void addFiles(def, e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-[13px] text-[var(--ink-soft)]">{t("photoCount", { count: list.length, max })}</p>
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            )}
            <ul className="space-y-2">
              {list.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border border-[var(--line)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className="size-12 rounded-[8px] object-cover" />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <span className="text-[13px]">{t("uploaded")}</span>
                  <Button type="button" variant="outline" className="h-11 min-h-11" onClick={() => void removePhoto(def.key, p.id)}>
                    {t("remove")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      case "address": {
        const a = { ...EMPTY_ADDRESS, ...(answers.address as object | undefined) } as Record<string, string>;
        const parts5: [string, string][] = [
          ["line1", "line1"],
          ["line2", "line2"],
          ["city", "city"],
          ["region", "region"],
          ["postalCode", "postalCode"],
        ];
        return (
          <fieldset className="space-y-3" key={def.key}>
            <legend className="text-sm font-medium">{label}</legend>
            {parts5.map(([k]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`${id}-${k}`}>{t(`fields.address.${k}`)}</Label>
                <Input
                  id={`${id}-${k}`}
                  className="h-11"
                  value={a[k] ?? ""}
                  onChange={(e) => {
                    setAddress(k, e.target.value);
                    if (k === "postalCode") setZipNote(null);
                  }}
                  onBlur={
                    k === "postalCode"
                      ? async (e) => {
                          try {
                            const res = await checkPostalCodePublic(e.target.value);
                            setZipNote(res && !res.ok ? (res.message ?? null) : null);
                          } catch (err) {
                            if (err instanceof Error && err.name === "AuthError") throw err;
                            setZipNote(null);
                          }
                        }
                      : undefined
                  }
                />
                {k === "postalCode" && zipNote && (
                  <p role="alert" className="text-sm text-destructive">
                    {zipNote}
                  </p>
                )}
              </div>
            ))}
            {err && (
              <p role="alert" className="text-sm text-destructive">
                {err}
              </p>
            )}
          </fieldset>
        );
      }
      case "days":
        return (
          <fieldset className="space-y-3" key={def.key}>
            <legend className="text-sm font-medium">{label}</legend>
            <div className="flex flex-wrap gap-3">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <label key={d} className="flex min-h-11 items-center gap-2 text-sm">
                  <Checkbox
                    checked={days.includes(d)}
                    onCheckedChange={(c) =>
                      setDays((prev) => (c ? [...prev, d] : prev.filter((x) => x !== d)))
                    }
                  />
                  {t(`fields.days.d${d}`)}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {PARTS.map((p) => (
                <label key={p} className="flex min-h-11 items-center gap-2 text-sm">
                  <Checkbox
                    checked={parts.includes(p)}
                    onCheckedChange={(c) =>
                      setParts((prev) => (c ? [...prev, p] : prev.filter((x) => x !== p)))
                    }
                  />
                  {t(`fields.preferred_days.${p}`)}
                </label>
              ))}
            </div>
          </fieldset>
        );
      default: {
        const _never: never = def.kind;
        return _never;
      }
    }
  }
}

/** Field keys that have a translated label / hint in en.json. */
const LABELLED: Record<string, true> = {
  placement: true, size: true, style: true, budget: true, references: true,
  description: true, photos: true, address: true, preferred_days: true,
};
const HINTED: Record<string, true> = {
  placement: true, style: true, references: true, description: true, photos: true,
};
