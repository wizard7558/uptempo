"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientSearch } from "@/components/booking/client-search";
import { useT } from "@/lib/terms/client";
import {
  addToClass,
  cancelClass,
  clientClassCredit,
  markAttendance,
  staffCancelEnrollment,
  updateCapacity,
} from "@/actions/classes";
import type { RosterEntry } from "@/actions/classes";

type PickedClient = { id: string; name: string; email: string | null; phone: string | null };

export type RosterSession = {
  id: string;
  className: string;
  staffName: string;
  /** "Mon, Jun 15, 6:00 AM to 6:45 AM", already in the business's time zone. */
  whenLabel: string;
  booked: number;
  capacity: number;
  status: "scheduled" | "cancelled" | "completed";
};

export function RosterView({
  session,
  booked,
  waitlist,
  canAdmin,
}: {
  session: RosterSession;
  booked: RosterEntry[];
  waitlist: RosterEntry[];
  /** Owners and admins also see Change spots and Cancel class. */
  canAdmin: boolean;
}) {
  const t = useT("classes");
  const router = useRouter();
  const open = session.status === "scheduled";
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<RosterEntry | null>(null);
  const [confirmClass, setConfirmClass] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [credit, setCredit] = useState<{ hasCredit: boolean; name: string | null; remaining: number }>({
    hasCredit: false,
    name: null,
    remaining: 0,
  });
  const [useCredit, setUseCredit] = useState(true);
  const [spots, setSpots] = useState(String(session.capacity));

  /** Runs one action, shows its plain-sentence failure, and reloads the page data on success. */
  async function run<R extends { success: boolean }>(
    action: () => Promise<R>,
    onDone?: (res: Extract<R, { success: true }>) => void,
  ) {
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (!res.success) {
      setError("error" in res ? String((res as { error: unknown }).error) : t("errors.invalid"));
      return false;
    }
    onDone?.(res as Extract<R, { success: true }>);
    router.refresh();
    return true;
  }

  async function pickClient(c: PickedClient | null) {
    setClient(c);
    setUseCredit(true);
    setCredit({ hasCredit: false, name: null, remaining: 0 });
    if (c) setCredit(await clientClassCredit(session.id, c.id));
  }

  async function onAdd() {
    if (!client) return;
    const picked = client;
    const ok = await run(
      () => addToClass(session.id, picked.id, credit.hasCredit && useCredit),
      (res) =>
        setNotice(
          res.status === "booked" ? t("addedBooked") : t("addedWaitlisted", { n: res.position ?? waitlist.length + 1 }),
        ),
    );
    if (ok) await pickClient(null);
  }

  async function onCancelSpot(refund: boolean) {
    const target = cancelTarget;
    if (!target) return;
    setCancelTarget(null);
    await run(() => staffCancelEnrollment(target.enrollmentId, refund));
  }

  async function onSaveSpots() {
    const n = Number(spots);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setError(t("errors.needSpots"));
      return;
    }
    await run(
      () => updateCapacity(session.id, n),
      () => setNotice(t("spotsNow", { count: n })),
    );
  }

  async function onCancelClass() {
    setConfirmClass(false);
    await run(
      () => cancelClass(session.id),
      () => setNotice(t("classCancelled")),
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{session.className}</h1>
        <p>{session.whenLabel}</p>
        <p className="text-muted-foreground">{t("public.with", { staff: session.staffName })}</p>
        <p>
          {t("bookedOf", { booked: session.booked, capacity: session.capacity })} - {t(`statuses.${session.status}`)}
        </p>
        {!open && <p className="font-medium">{t("lockedNote", { status: t(`statuses.${session.status}`).toLowerCase() })}</p>}
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}

      <section className="space-y-3" aria-labelledby="booked-heading">
        <h2 id="booked-heading" className="text-lg font-semibold">
          {t("bookedList")}
        </h2>
        {booked.length === 0 ? (
          <p className="text-muted-foreground">{t("noneBooked")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {booked.map((e) => (
              <li key={e.enrollmentId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{e.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.usesCredit ? t("usesCredit") : t("paysAtPlace")}
                    {e.status !== "booked" && <> - {t(`enrollment.${e.status}`)}</>}
                  </p>
                </div>
                {e.status === "booked" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={!open || busy}
                      onClick={() => void run(() => markAttendance(e.enrollmentId, "attended"))}
                    >
                      {t("checkIn")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={!open || busy}
                      onClick={() => void run(() => markAttendance(e.enrollmentId, "no_show"))}
                    >
                      {t("noShow")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      disabled={!open || busy}
                      onClick={() => setCancelTarget(e)}
                    >
                      {t("cancelSpot")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="waitlist-heading">
        <h2 id="waitlist-heading" className="text-lg font-semibold">
          {t("waitlist")}
        </h2>
        {waitlist.length === 0 ? (
          <p className="text-muted-foreground">{t("noneWaiting")}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {waitlist.map((e, i) => (
              <li key={e.enrollmentId} className="p-3">
                {t("waitlistRow", { n: e.waitlistPosition ?? i + 1, name: e.name })}
              </li>
            ))}
          </ol>
        )}
      </section>

      {open && (
        <section className="space-y-3" aria-labelledby="add-heading">
          <h2 id="add-heading" className="text-lg font-semibold">
            {t("addCustomer")}
          </h2>
          <ClientSearch selectedClient={client} onSelect={(c) => void pickClient(c)} />
          {client && credit.hasCredit && (
            <div className="flex items-center gap-3">
              <Checkbox
                id="use-credit"
                className="size-6"
                checked={useCredit}
                onCheckedChange={(v) => setUseCredit(v === true)}
              />
              <Label htmlFor="use-credit" className="text-base">
                {t("useOneCredit")}
              </Label>
              <span className="text-sm text-muted-foreground">
                {t("creditLeft", { name: client.name, count: credit.remaining })}
              </span>
            </div>
          )}
          <Button type="button"  variant="default" disabled={!client || busy} onClick={() => void onAdd()}>
            {t("addButton")}
          </Button>
        </section>
      )}

      {canAdmin && (
        <section className="space-y-6 border-t pt-6">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t("changeSpots")}</h2>
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="spots">{t("spots")}</Label>
                <Input
                  id="spots"
                  className="h-11 w-28"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={spots}
                  disabled={!open}
                  onChange={(e) => setSpots(e.target.value)}
                />
              </div>
              <Button type="button" variant="outline" className="h-11" disabled={!open || busy} onClick={() => void onSaveSpots()}>
                {t("saveSpots")}
              </Button>
            </div>
          </div>
          <Button type="button" variant="outline" className="h-11" disabled={!open || busy} onClick={() => setConfirmClass(true)}>
            {t("cancelClass")}
          </Button>
        </section>
      )}

      <Dialog open={cancelTarget !== null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          {cancelTarget?.usesCredit ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("giveBackTitle")}</DialogTitle>
              </DialogHeader>
              <p>{t("giveBackBody")}</p>
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11" onClick={() => void onCancelSpot(false)}>
                  {t("keepIt")}
                </Button>
                <Button type="button"  variant="default" onClick={() => void onCancelSpot(true)}>
                  {t("giveBack")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("cancelSpotTitle")}</DialogTitle>
              </DialogHeader>
              <p>{t("cancelSpotBody")}</p>
              <DialogFooter>
                <Button type="button" variant="outline" className="h-11" onClick={() => setCancelTarget(null)}>
                  {t("keepSpot")}
                </Button>
                <Button type="button"  variant="default" onClick={() => void onCancelSpot(false)}>
                  {t("cancelSpot")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClass} onOpenChange={setConfirmClass}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelClassConfirm")}</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmClass(false)}>
              {t("keepClass")}
            </Button>
            <Button type="button"  variant="default" onClick={() => void onCancelClass()}>
              {t("cancelClass")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
