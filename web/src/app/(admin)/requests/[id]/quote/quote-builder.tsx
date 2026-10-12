"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, SendIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import { dollarsToCents } from "@/lib/requests/fields";
import { formatDuration, LINE_MINUTE_OPTIONS, quoteTotals } from "@/lib/requests/quote-math";
import { QUOTE_VALID_DAYS, type QuoteValidDays } from "@/lib/requests/status";
import { saveQuoteDraft, sendQuote } from "@/actions/requests";

export type BuilderService = { id: string; name: string; priceCents: number | null; defaultDurationMinutes: number };

export type BuilderInitial = {
  quoteId?: string;
  staffId: string | null;
  lines: { serviceId: string; description: string; quantity: number; unitCents: number; minutes: number }[];
  depositCents: number;
  message: string;
  validDays: QuoteValidDays;
  /** Sessions when the quote is tracked as a multi-session project; null/absent for a single visit. */
  projectSessions?: number | null;
};

const PROJECT_SESSION_OPTIONS = Array.from({ length: 11 }, (_, i) => i + 2);

type LineState = { key: number; serviceId: string; description: string; quantity: string; price: string; minutes: number };

const centsToInput = (cents: number) => (cents / 100).toFixed(2);
const snapMinutes = (m: number) => Math.min(600, Math.max(15, Math.round(m / 15) * 15));

export function QuoteBuilder({
  requestId,
  clientName,
  services,
  staff,
  initial,
  projectsOn = false,
}: {
  requestId: string;
  clientName: string;
  services: BuilderService[];
  staff: { id: string; displayName: string }[];
  initial?: BuilderInitial;
  /** The projects module is on for this business. */
  projectsOn?: boolean;
}) {
  const t = useT("requests");
  const tp = useT("projects");
  const router = useRouter();
  const [quoteId, setQuoteId] = useState(initial?.quoteId);
  const [nextKey, setNextKey] = useState(initial ? initial.lines.length : 1);
  const [lines, setLines] = useState<LineState[]>(
    initial?.lines.length
      ? initial.lines.map((l, i) => ({
          key: i,
          serviceId: l.serviceId,
          description: l.description,
          quantity: String(l.quantity),
          price: centsToInput(l.unitCents),
          minutes: l.minutes,
        }))
      : [{ key: 0, serviceId: "", description: "", quantity: "1", price: "", minutes: 0 }],
  );
  const [deposit, setDeposit] = useState(initial ? centsToInput(initial.depositCents) : "0.00");
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [validDays, setValidDays] = useState<QuoteValidDays>(initial?.validDays ?? 14);
  const [message, setMessage] = useState(initial?.message ?? "");
  const [trackProject, setTrackProject] = useState(initial?.projectSessions != null);
  const [projectSessions, setProjectSessions] = useState(String(initial?.projectSessions ?? 3));
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const words = { min: (count: number) => t("builder.min", { count }), hr: (count: number) => t("builder.hr", { count }) };
  const parsed = lines.map((l) => ({
    quantity: Number.parseInt(l.quantity, 10) || 0,
    unitCents: dollarsToCents(l.price) ?? 0,
    minutes: l.minutes,
  }));
  const totals = quoteTotals(parsed);

  const patch = (key: number, p: Partial<LineState>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));

  function pickService(key: number, serviceId: string) {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return patch(key, { serviceId: "" });
    patch(key, {
      serviceId,
      description: svc.name,
      price: svc.priceCents != null ? centsToInput(svc.priceCents) : "",
      minutes: snapMinutes(svc.defaultDurationMinutes),
    });
  }

  function buildInput() {
    const depositCents = dollarsToCents(deposit);
    const out = lines.map((l, i) => ({
      serviceId: l.serviceId,
      description: l.description.trim(),
      quantity: parsed[i].quantity,
      unitCents: dollarsToCents(l.price),
      minutes: l.minutes,
    }));
    if (
      depositCents === null ||
      out.some((l) => !l.serviceId || !l.description || l.unitCents === null || l.quantity < 1 || l.quantity > 100)
    ) {
      return null;
    }
    return {
      requestId,
      quoteId,
      staffId: staffId || null,
      lines: out.map((l) => ({ ...l, unitCents: l.unitCents as number })),
      depositCents,
      validDays,
      message: message.trim() || undefined,
      ...(projectsOn ? { projectSessions: trackProject ? Number(projectSessions) : null } : {}),
    };
  }

  async function save(): Promise<string | null> {
    setError(null);
    const input = buildInput();
    if (!input) {
      setError(t("required"));
      return null;
    }
    const res = await saveQuoteDraft(input);
    if (!res.success) {
      setError(res.error);
      return null;
    }
    setQuoteId(res.quoteId);
    return res.quoteId;
  }

  async function onSave() {
    setBusy("save");
    const id = await save();
    setBusy(null);
    if (id) toast.success(t("builder.saved"));
  }

  async function onSend() {
    setBusy("send");
    const id = await save();
    if (id) {
      const res = await sendQuote(id, validDays);
      if (res.success) {
        toast.success(t("builder.sent", { name: clientName }));
        router.push(`/requests/${requestId}`);
        router.refresh();
        return;
      }
      setError(res.error);
    }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("builder.title")}</h1>

      <ul className="space-y-4">
        {lines.map((l, i) => (
          <li key={l.key} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-6">
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor={`svc-${l.key}`}>{t("builder.service")}</Label>
              <NativeSelect id={`svc-${l.key}`} value={l.serviceId} onChange={(e) => pickService(l.key, e.target.value)}>
                <option value="">{t("builder.pickService")}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor={`desc-${l.key}`}>{t("builder.description")}</Label>
              <Input id={`desc-${l.key}`} className="h-11" value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`qty-${l.key}`}>{t("builder.quantity")}</Label>
              <Input id={`qty-${l.key}`} className="h-11" type="number" min={1} max={100} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`price-${l.key}`}>{t("builder.unitPrice")}</Label>
              <div className="flex items-center gap-2">
                <span aria-hidden>$</span>
                <Input id={`price-${l.key}`} className="h-11" inputMode="decimal" value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`time-${l.key}`}>{t("builder.time")}</Label>
              <NativeSelect id={`time-${l.key}`} value={String(l.minutes)} onChange={(e) => patch(l.key, { minutes: Number(e.target.value) })}>
                <option value="0">{t("builder.noTime")}</option>
                {LINE_MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {formatDuration(m, words)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {lines.length > 1 && (
              <div className="sm:col-span-6">
                <Button type="button" variant="outline" className="h-11" aria-label={`${t("builder.remove")} ${i + 1}`} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                  <Trash2Icon aria-hidden />
                  {t("builder.remove")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={lines.length >= 20}
        onClick={() => {
          setLines((prev) => [...prev, { key: nextKey, serviceId: "", description: "", quantity: "1", price: "", minutes: 0 }]);
          setNextKey((k) => k + 1);
        }}
      >
        <PlusIcon aria-hidden />
        {t("builder.addLine")}
      </Button>

      <dl className="grid gap-2 rounded-lg border p-4 text-base sm:grid-cols-2">
        <div className="flex justify-between sm:block">
          <dt className="text-sm text-muted-foreground">{t("builder.total")}</dt>
          <dd className="text-xl font-semibold">{formatCurrency(totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between sm:block">
          <dt className="text-sm text-muted-foreground">{t("builder.timeNeeded")}</dt>
          <dd className="text-xl font-semibold">{totals.minutes > 0 ? formatDuration(totals.minutes, words) : t("builder.noTime")}</dd>
        </div>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="deposit">{t("builder.deposit")}</Label>
          <div className="flex items-center gap-2">
            <span aria-hidden>$</span>
            <Input id="deposit" className="h-11" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">{t("builder.depositHint")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="who">{t("builder.who")}</Label>
          <NativeSelect id="who" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{t("builder.anyone")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="valid">{t("builder.validFor")}</Label>
          <NativeSelect id="valid" value={String(validDays)} onChange={(e) => setValidDays(Number(e.target.value) as QuoteValidDays)}>
            {QUOTE_VALID_DAYS.map((d) => (
              <option key={d} value={d}>
                {t("builder.days", { count: d })}
              </option>
            ))}
          </NativeSelect>
        </div>
        {projectsOn && (
          <div className="space-y-3 sm:col-span-2">
            <div className="flex min-h-11 items-center gap-3">
              <Switch id="track-project" checked={trackProject} onCheckedChange={setTrackProject} />
              <Label htmlFor="track-project">{tp("trackAsProject")}</Label>
            </div>
            {trackProject && (
              <div className="max-w-xs space-y-1">
                <Label htmlFor="project-sessions">{tp("sessions")}</Label>
                <NativeSelect id="project-sessions" value={projectSessions} onChange={(e) => setProjectSessions(e.target.value)}>
                  {PROJECT_SESSION_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </div>
        )}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="note">{t("builder.message")}</Label>
          <Textarea id="note" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void onSave()}>
          <SaveIcon aria-hidden />
          {busy === "save" ? t("builder.saving") : t("builder.saveDraft")}
        </Button>
        <Button type="button"  variant="default" disabled={busy !== null} onClick={() => void onSend()}>
          <SendIcon aria-hidden />
          {busy === "send" ? t("builder.sending") : t("builder.send")}
        </Button>
      </div>
    </div>
  );
}
