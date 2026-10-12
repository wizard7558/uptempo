"use client";

import { useState } from "react";
import { useT } from "@/lib/terms/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  adjustGiftCardBalance,
  cancelGiftCard,
  getGiftCardHistory,
  listGiftCards,
  sellGiftCardInPerson,
  sendNewGiftCardCode,
  type GiftCardHistoryRow,
  type GiftCardRow,
} from "@/actions/gift-cards";

function money(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function signed(cents: number): string {
  return `${cents < 0 ? "-" : ""}${money(cents)}`;
}

function soldOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function GiftCardsClient({
  initial,
}: {
  initial: { rows: GiftCardRow[]; outstandingCents: number };
}) {
  const t = useT("giftCards");
  const [rows, setRows] = useState(initial.rows);
  const [outstandingCents, setOutstandingCents] = useState(initial.outstandingCents);
  const [sellOpen, setSellOpen] = useState(false);
  const [issued, setIssued] = useState<{ code: string; emailed: boolean; email: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [paid, setPaid] = useState<"in_person" | "comp">("in_person");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<GiftCardRow | null>(null);
  const [history, setHistory] = useState<GiftCardHistoryRow[]>([]);
  const [adjustFor, setAdjustFor] = useState<GiftCardRow | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [cancelFor, setCancelFor] = useState<GiftCardRow | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [replaceFor, setReplaceFor] = useState<GiftCardRow | null>(null);

  async function reload() {
    const next = await listGiftCards({});
    setRows(next.rows);
    setOutstandingCents(next.outstandingCents);
  }

  function resetSell() {
    setAmount("");
    setRecipientName("");
    setRecipientEmail("");
    setPaid("in_person");
    setIssued(null);
    setError(null);
  }

  async function createCard(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const dollars = Number(amount);
    if (!Number.isFinite(dollars)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sellGiftCardInPerson({
        amountCents: Math.round(dollars * 100),
        recipientName,
        recipientEmail,
        paid,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setIssued({ code: result.code, emailed: result.emailed, email: recipientEmail });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(row: GiftCardRow) {
    setHistoryFor(row);
    const result = await getGiftCardHistory(row.id);
    setHistory("rows" in result ? result.rows : []);
  }

  async function saveAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustFor || busy) return;
    const dollars = Number(adjustAmount);
    if (!Number.isFinite(dollars)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adjustGiftCardBalance({
        id: adjustFor.id,
        deltaCents: Math.round(dollars * 100),
        note: adjustNote,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAdjustFor(null);
      setAdjustAmount("");
      setAdjustNote("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelFor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cancelGiftCard({ id: cancelFor.id, note: cancelNote || "Cancelled" });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCancelFor(null);
      setCancelNote("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function sendNew(row: GiftCardRow) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendNewGiftCardCode({ id: row.id });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setIssued({ code: result.code, emailed: result.emailed, email: row.recipientEmail ?? "" });
      setSellOpen(true);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl text-[var(--ink)]">{t("admin.title")}</h1>
          <p className="mt-1 text-base text-[var(--ink-soft)]">{t("admin.subtitle")}</p>
        </div>
        <Button className="h-12" onClick={() => { resetSell(); setSellOpen(true); }}>
          {t("admin.sell")}
        </Button>
      </div>
      <p className="mt-6 text-base text-[var(--ink)]">
        {t("admin.outstanding")}: {money(outstandingCents)}
      </p>
      {error && !sellOpen && !adjustFor && !cancelFor && !replaceFor && (
        <p role="alert" className="mt-4 text-base text-destructive">{error}</p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-[var(--line)] text-sm text-[var(--ink-soft)]">
              <th className="py-2 pr-4 font-medium">{t("admin.colCard")}</th>
              <th className="py-2 pr-4 font-medium">{t("admin.colBalance")}</th>
              <th className="py-2 pr-4 font-medium">{t("admin.colSold")}</th>
              <th className="py-2 pr-4 font-medium">{t("admin.colFor")}</th>
              <th className="py-2 pr-4 font-medium">{t("admin.colStatus")}</th>
              <th className="py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--line)]">
                <td className="py-3 pr-4">{t("admin.endingIn", { last4: row.last4 })}</td>
                <td className="py-3 pr-4">{money(row.balanceCents)}</td>
                <td className="py-3 pr-4">{soldOn(row.createdAt)}</td>
                <td className="py-3 pr-4">{row.recipientName || row.recipientEmail || ""}</td>
                <td className="py-3 pr-4">
                  {row.status === "active" ? t("admin.active") : t("admin.void")}
                  {row.source === "online" && !row.deliveredAt ? ` · ${t("admin.notDelivered")}` : ""}
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-10" onClick={() => void openHistory(row)}>
                      {t("admin.history")}
                    </Button>
                    {row.status === "active" && (
                      <Button type="button" variant="outline" className="h-10" onClick={() => { setAdjustFor(row); setError(null); }}>
                        {t("admin.adjust")}
                      </Button>
                    )}
                    {row.status === "active" && row.recipientEmail && (
                      <Button type="button" variant="outline" className="h-10" onClick={() => { setReplaceFor(row); setError(null); }}>
                        {t("admin.newCode")}
                      </Button>
                    )}
                    {row.status === "active" && (
                      <Button type="button" variant="outline" className="h-10" onClick={() => { setCancelFor(row); setError(null); }}>
                        {t("admin.voidButton")}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8 border border-[var(--line)] p-4">
        <h2 className="text-lg text-[var(--ink)]">{t("admin.notesTitle")}</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-[var(--ink-soft)]">
          <li>{t("admin.liabilityNote")}</li>
          <li>{t("admin.taxNote")}</li>
          <li>{t("admin.expiryNote")}</li>
          <li>{t("admin.refundNote")}</li>
        </ul>
      </section>

      <Dialog open={sellOpen} onOpenChange={(open) => { setSellOpen(open); if (!open) resetSell(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{issued ? t("admin.codeTitle") : t("admin.sellTitle")}</DialogTitle>
          </DialogHeader>
          {issued ? (
            <div className="space-y-4">
              <p className="text-base">{t("admin.codeBody")}</p>
              <p data-testid="gift-card-code" className="text-2xl tracking-[2px] text-[var(--ink)]">
                {issued.code}
              </p>
              {issued.emailed && issued.email && (
                <p className="text-sm text-[var(--ink-soft)]">{t("admin.emailed", { email: issued.email })}</p>
              )}
              <Button className="h-12 w-full" onClick={() => { setSellOpen(false); resetSell(); }}>
                {t("admin.close")}
              </Button>
            </div>
          ) : (
            <form onSubmit={createCard} className="space-y-4">
              <div className="space-y-2">
                <p className="text-base">{t("admin.amount")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[2500, 5000, 10000, 15000].map((cents) => (
                    <Button
                      key={cents}
                      type="button"
                      variant={amount === String(cents / 100) ? "default" : "outline"}
                      className="h-12"
                      onClick={() => setAmount(String(cents / 100))}
                    >
                      {`$${cents / 100}`}
                    </Button>
                  ))}
                </div>
                <Label htmlFor="gc-sell-other">{t("public.custom")}</Label>
                <Input
                  id="gc-sell-other"
                  className="h-12"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <p className="text-sm text-[var(--ink-soft)]">{t("public.customHint")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gc-sell-name">{t("admin.recipientName")}</Label>
                <Input id="gc-sell-name" className="h-12" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gc-sell-email">{t("admin.recipientEmail")}</Label>
                <Input id="gc-sell-email" type="email" className="h-12" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-base">{t("admin.howPaid")}</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="paid" checked={paid === "in_person"} onChange={() => setPaid("in_person")} />
                  {t("admin.paidInPerson")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="paid" checked={paid === "comp"} onChange={() => setPaid("comp")} />
                  {t("admin.comp")}
                </label>
              </fieldset>
              {error && <p role="alert" className="text-base text-destructive">{error}</p>}
              <Button type="submit" className="h-12 w-full" disabled={busy}>{t("admin.create")}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={historyFor !== null} onOpenChange={(open) => { if (!open) setHistoryFor(null); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("admin.history")}</SheetTitle>
          </SheetHeader>
          <ul className="mt-4 space-y-3">
            {history.map((row) => (
              <li key={row.id} className="text-base">
                <span>{t(`admin.reasons.${row.reason}`)}</span>
                <span> {signed(row.deltaCents)}</span>
                {row.note ? <span className="block text-sm text-[var(--ink-soft)]">{row.note}</span> : null}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>

      <Dialog open={adjustFor !== null} onOpenChange={(open) => { if (!open) { setAdjustFor(null); setError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.adjustTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveAdjust} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gc-adjust-amount">{t("admin.adjustAmount")}</Label>
              <Input id="gc-adjust-amount" className="h-12" inputMode="decimal" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} required />
              <p className="text-sm text-[var(--ink-soft)]">{t("admin.adjustHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gc-adjust-note">{t("admin.adjustNote")}</Label>
              <Input id="gc-adjust-note" className="h-12" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} required />
            </div>
            {error && <p role="alert" className="text-base text-destructive">{error}</p>}
            <Button type="submit" className="h-12 w-full" disabled={busy}>{t("admin.save")}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelFor !== null} onOpenChange={(open) => { if (!open) { setCancelFor(null); setError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.voidButton")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={confirmCancel} className="space-y-4">
            <p className="text-base">{t("admin.voidConfirm")}</p>
            <div className="space-y-2">
              <Label htmlFor="gc-cancel-note">{t("admin.adjustNote")}</Label>
              <Input id="gc-cancel-note" className="h-12" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} required />
            </div>
            {error && <p role="alert" className="text-base text-destructive">{error}</p>}
            <Button type="submit" className="h-12 w-full" disabled={busy}>{t("admin.voidButton")}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={replaceFor !== null} onOpenChange={(open) => { if (!open) { setReplaceFor(null); setError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.newCode")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!replaceFor) return;
              const row = replaceFor;
              setReplaceFor(null);
              void sendNew(row);
            }}
            className="space-y-4"
          >
            <p className="text-base">{t("admin.newCodeConfirm")}</p>
            <Button type="submit" className="h-12 w-full" disabled={busy}>{t("admin.newCode")}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
