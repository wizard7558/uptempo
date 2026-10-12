"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/lib/terms/client";
import { formatCurrency } from "@/lib/format";
import {
  adjustCredits,
  sellPackageAdmin,
  type ClientCredits,
  type PackageRow,
} from "@/actions/packages";

interface Props {
  clientId: string;
  credits: ClientCredits;
  /** Packs on sale. Empty for staff who may not sell. */
  packs: PackageRow[];
  hasCard: boolean;
}

export function ClientCreditsCard({ clientId, credits, packs, hasCard }: Props) {
  const t = useT("packages");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sellOpen, setSellOpen] = useState(false);
  const [packId, setPackId] = useState("");
  const [payment, setPayment] = useState<"card_on_file" | "cash">(hasCard ? "card_on_file" : "cash");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPack, setAdjustPack] = useState("");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = credits.packages.filter((p) => p.status === "active");
  const onSale = packs.filter((p) => p.isActive);

  function openSell() {
    setError(null);
    setPackId(onSale[0]?.id ?? "");
    setPayment(hasCard ? "card_on_file" : "cash");
    setSellOpen(true);
  }

  function openAdjust() {
    setError(null);
    setAdjustPack(credits.packages[0]?.id ?? "");
    setDelta("");
    setNote("");
    setAdjustOpen(true);
  }

  function sell() {
    setError(null);
    startTransition(async () => {
      const res = await sellPackageAdmin({ clientId, packageId: packId, payment });
      if (res.success) {
        toast.success(t("sold"));
        setSellOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function adjust() {
    setError(null);
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0 || n < -50 || n > 50 || !note.trim()) {
      setError(t("errors.invalid"));
      return;
    }
    startTransition(async () => {
      const res = await adjustCredits({ clientPackageId: adjustPack, delta: n, note });
      if (res.success) {
        toast.success(t("adjusted"));
        setAdjustOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{t("creditsCard")}</CardTitle>
        <div className="flex gap-2">
          {credits.canManage && (
            <>
              <Button type="button" variant="outline" className="h-11" onClick={openSell}>
                {t("sell")}
              </Button>
              {credits.packages.length > 0 && (
                <Button type="button" variant="outline" className="h-11" onClick={openAdjust}>
                  {t("adjust")}
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {credits.packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCredits")}</p>
        ) : (
          <ul className="divide-y">
            {credits.packages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  {p.expiresAt && (
                    <p className="text-sm text-muted-foreground">
                      {t("expiresOn", { date: format(new Date(p.expiresAt), "MMM d, yyyy") })}
                    </p>
                  )}
                </div>
                <p className="text-sm font-medium">
                  {p.status === "expired" ? t("expired") : t("left", { count: p.creditsRemaining })}
                </p>
              </li>
            ))}
          </ul>
        )}

        {credits.ledger.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("historyTitle")}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colDate")}</TableHead>
                  <TableHead>{t("colChange")}</TableHead>
                  <TableHead>{t("colReason")}</TableHead>
                  <TableHead className="text-right">{t("colBalance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.ledger.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{format(new Date(e.createdAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>{e.change}</TableCell>
                    <TableCell>
                      {t(`reasons.${e.reason}`)}
                      {e.note ? ` - ${e.note}` : ""}
                    </TableCell>
                    <TableCell className="text-right">{e.balanceAfter}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sell")}</DialogTitle>
          </DialogHeader>
          {onSale.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPacksToSell")}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="sell-pack">{t("pickPack")}</Label>
                <Select value={packId} onValueChange={setPackId}>
                  <SelectTrigger id="sell-pack" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {onSale.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} - {t("summary", { credits: p.credits, price: formatCurrency(p.priceCents) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">{t("payment")}</legend>
                {(["card_on_file", "cash"] as const).map((k) => (
                  <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="pack-payment"
                      checked={payment === k}
                      disabled={k === "card_on_file" && !hasCard}
                      onChange={() => setPayment(k)}
                    />
                    {k === "card_on_file" ? t("cardOnFile") : t("cash")}
                  </label>
                ))}
                {!hasCard && <p className="text-sm text-muted-foreground">{t("errors.noCard")}</p>}
              </fieldset>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setSellOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              
              variant="default"
              disabled={pending || !packId || onSale.length === 0}
              onClick={sell}
            >
              {t("sellConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adjustTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="adjust-pack">{t("adjustPack")}</Label>
              <Select value={adjustPack} onValueChange={setAdjustPack}>
                <SelectTrigger id="adjust-pack" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(active.length ? active : credits.packages).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({t("left", { count: p.creditsRemaining })})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjust-delta">{t("adjustBy")}</Label>
              <Input
                id="adjust-delta"
                className="h-11"
                inputMode="numeric"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjust-note">{t("adjustNote")}</Label>
              <Input
                id="adjust-note"
                className="h-11"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setAdjustOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button"  variant="default" disabled={pending} onClick={adjust}>
              {t("adjustSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
