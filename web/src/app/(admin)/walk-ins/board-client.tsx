"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { CheckoutDialog } from "@/components/checkout/checkout-dialog";
import { usePolling } from "@/hooks/use-polling";
import { useT } from "@/lib/terms/client";
import {
  addWalkIn,
  callEntry,
  callNext,
  createKioskLink,
  finishService,
  getQueueBoard,
  markLeft,
  setQueueOpen,
  startService,
  updateQueueSettings,
  type QueueBoardView,
  type QueueEntryView,
} from "@/actions/queue";

type T = ReturnType<typeof useT>;
type Finished = { entryId: string; appointmentId: string; name: string };

const POLL_MS = 5000;

function minutesSince(iso: string, nowIso: string): number {
  return Math.max(0, Math.floor((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60_000));
}

function timeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function BoardClient({
  initial,
  initialLocationId,
  canManage,
}: {
  initial: QueueBoardView;
  initialLocationId: string | null;
  canManage: boolean;
}) {
  const t = useT("queue");
  const [locationId, setLocationId] = useState<string | null>(initialLocationId);
  const [local, setLocal] = useState<QueueBoardView | null>(null);
  const [busy, startTransition] = useTransition();
  const [finished, setFinished] = useState<Finished[]>([]);
  const [checkoutFor, setCheckoutFor] = useState<Finished | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [serviceFor, setServiceFor] = useState<QueueEntryView | null>(null);

  const { data: polled, error } = usePolling(() => getQueueBoard(locationId), { intervalMs: POLL_MS });

  // Show whichever copy is newest: the server render, the last poll, or the refresh after a click.
  const board = [initial, polled, local]
    .filter((b): b is QueueBoardView => b !== null)
    .reduce((a, b) => (new Date(b.now) >= new Date(a.now) ? b : a));

  async function refresh(loc: string | null = locationId) {
    setLocal(await getQueueBoard(loc));
  }

  /** Runs an action, shows its error, and reloads the board. */
  function run(fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.success) toast.error(res.error ?? "");
      else after?.();
      await refresh();
    });
  }

  const staffName = (id: string | null) => board.staff.find((s) => s.id === id)?.name ?? "";

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t("board.title")}</h1>
        <p className="text-base text-muted-foreground">{t("board.subtitle")}</p>
      </div>

      {/* Top row */}
      <div className="flex flex-wrap items-center gap-3">
        {board.locations.length >= 2 && (
          <div className="flex items-center gap-2">
            <Label htmlFor="walkin-location" className="text-base">
              {t("board.location")}
            </Label>
            <NativeSelect
              id="walkin-location"
              className="h-11 text-base"
              value={locationId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setLocationId(next);
                void refresh(next);
              }}
            >
              {board.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <p role="status" className="text-base font-medium">
          {board.open ? t("board.open") : t("board.closedState")}
        </p>
        {canManage && (
          <Button
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => run(() => setQueueOpen(!board.open))}
          >
            {board.open ? t("board.closeButton") : t("board.openButton")}
          </Button>
        )}
        <Button className="h-11" onClick={() => setAddOpen(true)}>
          {t("board.addWalkIn")}
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/walk-ins/qr${locationId ? `?l=${locationId}` : ""}`}>{t("board.printQr")}</Link>
        </Button>
        {canManage && (
          <Button variant="outline" className="h-11" onClick={() => setKioskOpen(true)}>
            {t("board.kioskLink")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("board.loadFailed")}
        </p>
      )}

      {/* Staff strip */}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {board.staff.map((s) => {
          const free = s.freeAt !== null && new Date(s.freeAt) <= new Date(board.now);
          return (
            <li key={s.id} className="space-y-2 rounded-lg border p-4">
              <p className="text-lg font-medium">{s.name}</p>
              <p className="text-base">
                {s.freeAt === null
                  ? t("board.notAvailable")
                  : free
                    ? t("board.freeNow")
                    : t("board.busyUntil", { time: timeLabel(s.freeAt, board.timezone) })}
              </p>
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const res = await callNext({ locationId, staffId: s.id });
                    if (!res.success) toast.error(res.error);
                    else if ("empty" in res) toast(t("board.noOneWaitingFor", { name: s.name }));
                    else toast.success(t("board.calledToast", { name: res.entry.name }));
                    await refresh();
                  })
                }
              >
                {t("board.callNextFor", { name: s.name })}
              </Button>
            </li>
          );
        })}
      </ul>

      {/* Waiting */}
      <section aria-labelledby="walkin-waiting" className="space-y-3">
        <h2 id="walkin-waiting" className="text-xl font-semibold">
          {t("board.waiting")}
        </h2>
        {board.waiting.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("board.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {board.waiting.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-lg font-medium">
                    {e.position}. {e.name}
                    {e.phoneLast4 ? <span className="ml-2 text-base font-normal text-muted-foreground">...{e.phoneLast4}</span> : null}
                  </p>
                  <p className="text-base">
                    {e.serviceName ?? t("join.serviceAny")}
                    {" / "}
                    {e.preferredStaffName ? t("board.wants", { name: e.preferredStaffName }) : t("board.anyStaff")}
                  </p>
                  <p className="text-base text-muted-foreground">
                    {t("board.waitedFor", { minutes: minutesSince(e.joinedAt, board.now) })}
                    {" / "}
                    {e.waitMinutes === null ? t("board.estimateUnknown") : t("board.estimate", { minutes: e.waitMinutes })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <CallButton
                    t={t}
                    staff={board.staff}
                    disabled={busy}
                    onPick={(staffId) =>
                      startTransition(async () => {
                        const res = await callEntry({ entryId: e.id, staffId });
                        if (!res.success) toast.error(res.error);
                        else if ("entry" in res) toast.success(t("board.calledToast", { name: res.entry.name }));
                        await refresh();
                      })
                    }
                  />
                  <Button variant="outline" className="h-11" disabled={busy} onClick={() => run(() => markLeft({ entryId: e.id }))}>
                    {t("board.left")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Called */}
      <section aria-labelledby="walkin-called" className="space-y-3">
        <h2 id="walkin-called" className="text-xl font-semibold">
          {t("board.called")}
        </h2>
        <ul className="space-y-3">
          {board.called.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-lg font-medium">{e.name}</p>
                <p className="text-base">
                  {t("board.calledFor", { name: e.assignedStaffName ?? staffName(e.assignedStaffId) })}
                  {e.serviceName ? ` / ${e.serviceName}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  className="h-11"
                  disabled={busy}
                  onClick={() => {
                    if (!e.serviceId) {
                      setServiceFor(e);
                      return;
                    }
                    run(() => startService({ entryId: e.id }));
                  }}
                >
                  {t("board.start")}
                </Button>
                <Button variant="outline" className="h-11" disabled={busy} onClick={() => run(() => markLeft({ entryId: e.id }))}>
                  {t("board.noShow")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Being served */}
      <section aria-labelledby="walkin-serving" className="space-y-3">
        <h2 id="walkin-serving" className="text-xl font-semibold">
          {t("board.inService")}
        </h2>
        <ul className="space-y-3">
          {board.inService.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-lg font-medium">{e.name}</p>
                <p className="text-base">
                  {t("board.servedBy", { name: e.assignedStaffName ?? staffName(e.assignedStaffId) })}
                  {e.serviceName ? ` / ${e.serviceName}` : ""}
                </p>
              </div>
              <Button
                className="h-11"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const res = await finishService({ entryId: e.id });
                    if (!res.success) toast.error(res.error);
                    else if (res.appointmentId) {
                      const appointmentId = res.appointmentId;
                      setFinished((list) => [...list, { entryId: e.id, appointmentId, name: e.name }]);
                    }
                    await refresh();
                  })
                }
              >
                {t("board.done")}
              </Button>
            </li>
          ))}
          {finished.map((f) => (
            <li key={f.entryId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
              <p className="text-lg font-medium">{f.name}</p>
              <div className="flex gap-2">
                <Button className="h-11" onClick={() => setCheckoutFor(f)}>
                  {t("board.checkOut")}
                </Button>
                <Button variant="outline" className="h-11" onClick={() => setFinished((list) => list.filter((x) => x.entryId !== f.entryId))}>
                  {t("board.hide")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {canManage && <SettingsCard t={t} board={board} onSaved={() => refresh()} />}

      <CheckoutDialog
        appointmentId={checkoutFor?.appointmentId ?? null}
        onClose={() => setCheckoutFor(null)}
        onComplete={() => {
          const done = checkoutFor;
          setCheckoutFor(null);
          if (done) setFinished((list) => list.filter((x) => x.entryId !== done.entryId));
        }}
      />

      <AddDialog
        t={t}
        open={addOpen}
        onOpenChange={setAddOpen}
        board={board}
        locationId={locationId}
        onAdded={() => void refresh()}
      />

      {canManage && <KioskDialog t={t} open={kioskOpen} onOpenChange={setKioskOpen} />}

      <Dialog open={serviceFor !== null} onOpenChange={(o) => !o && setServiceFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("board.chooseService")}</DialogTitle>
            <DialogDescription>{serviceFor?.name}</DialogDescription>
          </DialogHeader>
          <ServiceChoice
            t={t}
            services={board.services}
            disabled={busy}
            onPick={(serviceId) => {
              const entry = serviceFor;
              if (!entry) return;
              setServiceFor(null);
              run(() => startService({ entryId: entry.id, serviceId }));
            }}
            onCancel={() => setServiceFor(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CallButton({
  t,
  staff,
  disabled,
  onPick,
}: {
  t: T;
  staff: { id: string; name: string }[];
  disabled: boolean;
  onPick: (staffId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="h-11" disabled={disabled}>
          {t("board.call")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <p className="text-base font-medium">{t("board.chooseStaff")}</p>
        {staff.map((s) => (
          <Button
            key={s.id}
            variant="outline"
            className="h-11 w-full justify-start"
            onClick={() => {
              setOpen(false);
              onPick(s.id);
            }}
          >
            {s.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ServiceChoice({
  t,
  services,
  disabled,
  onPick,
  onCancel,
}: {
  t: T;
  services: { id: string; name: string }[];
  disabled: boolean;
  onPick: (serviceId: string) => void;
  onCancel: () => void;
}) {
  const [serviceId, setServiceId] = useState("");
  return (
    <>
      <Label htmlFor="walkin-start-service" className="text-base">
        {t("join.serviceLabel")}
      </Label>
      <NativeSelect
        id="walkin-start-service"
        className="h-11 text-base"
        value={serviceId}
        onChange={(e) => setServiceId(e.target.value)}
      >
        <option value="" disabled>
          {t("board.chooseService")}
        </option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      <DialogFooter>
        <Button variant="outline" className="h-11" onClick={onCancel}>
          {t("board.cancel")}
        </Button>
        <Button className="h-11" disabled={disabled || !serviceId} onClick={() => onPick(serviceId)}>
          {t("board.start")}
        </Button>
      </DialogFooter>
    </>
  );
}

function AddDialog({
  t,
  open,
  onOpenChange,
  board,
  locationId,
  onAdded,
}: {
  t: T;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  board: QueueBoardView;
  locationId: string | null;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await addWalkIn({
        locationId,
        name,
        phone: phone.trim() ? phone : null,
        serviceId: serviceId || null,
        preferredStaffId: staffId || null,
        smsConsent: consent && phone.trim() !== "",
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setName("");
      setPhone("");
      setServiceId("");
      setStaffId("");
      setConsent(false);
      onOpenChange(false);
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("board.addDialogTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="walkin-name" className="text-base">
              {t("join.nameLabel")}
            </Label>
            <Input id="walkin-name" className="h-11 text-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="walkin-phone" className="text-base">
              {t("board.phoneOptional")}
            </Label>
            <Input id="walkin-phone" type="tel" inputMode="tel" className="h-11 text-base" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="walkin-service" className="text-base">
              {t("join.serviceLabel")}
            </Label>
            <NativeSelect id="walkin-service" className="h-11 text-base" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">{t("join.serviceAny")}</option>
              {board.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="walkin-staff" className="text-base">
              {t("join.staffLabel")}
            </Label>
            <NativeSelect id="walkin-staff" className="h-11 text-base" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{t("join.staffAny")}</option>
              {board.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="walkin-consent" className="mt-1 size-6" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <Label htmlFor="walkin-consent" className="text-base font-normal leading-snug">
              {t("board.consentLabel")}
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-base text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
              {t("board.cancel")}
            </Button>
            <Button type="submit" className="h-11" disabled={saving}>
              {t("board.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KioskDialog({ t, open, onOpenChange }: { t: T; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setUrl(null);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("board.kioskDialogTitle")}</DialogTitle>
          <DialogDescription>{t("board.kioskDialogBody")}</DialogDescription>
        </DialogHeader>
        <p className="text-base">{t("board.kioskWarning")}</p>
        {url && (
          <div className="space-y-2">
            <Input readOnly value={url} className="h-11 text-base" aria-label={t("board.kioskLink")} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              className="h-11"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast.success(t("board.copied"));
              }}
            >
              {t("board.copy")}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
            {t("board.close")}
          </Button>
          <Button
            className="h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await createKioskLink();
                setUrl(res.url);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("board.kioskCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsCard({ t, board, onSaved }: { t: T; board: QueueBoardView; onSaved: () => void }) {
  const [maxWaiting, setMaxWaiting] = useState(String(board.maxWaiting));
  const [textOnJoin, setTextOnJoin] = useState(board.textOnJoin);
  const [saving, setSaving] = useState(false);
  const n = Number(maxWaiting);
  const valid = Number.isInteger(n) && n >= 1 && n <= 200;
  return (
    <section aria-labelledby="walkin-settings" className="space-y-4 rounded-lg border p-4">
      <h2 id="walkin-settings" className="text-xl font-semibold">
        {t("board.settings.title")}
      </h2>
      <div className="space-y-2">
        <Label htmlFor="walkin-max" className="text-base">
          {t("board.settings.maxWaiting")}
        </Label>
        <Input
          id="walkin-max"
          type="number"
          min={1}
          max={200}
          className="h-11 w-32 text-base"
          value={maxWaiting}
          onChange={(e) => setMaxWaiting(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch id="walkin-text" checked={textOnJoin} onCheckedChange={setTextOnJoin} />
        <Label htmlFor="walkin-text" className="text-base font-normal">
          {t("board.settings.textOnJoin")}
        </Label>
      </div>
      <Button
        className="h-11"
        disabled={saving || !valid}
        onClick={async () => {
          setSaving(true);
          try {
            const res = await updateQueueSettings({ maxWaiting: n, textOnJoin });
            if (res.success) {
              toast.success(t("board.settings.saved"));
              onSaved();
            } else toast.error(res.error);
          } finally {
            setSaving(false);
          }
        }}
      >
        {t("board.settings.save")}
      </Button>
    </section>
  );
}
