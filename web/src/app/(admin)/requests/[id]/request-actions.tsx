"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, UndoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/lib/terms/client";
import { declineRequest, withdrawQuote } from "@/actions/requests";

/** Read-only quote link with a Copy button, and Withdraw for a quote that is out with the client. */
export function QuoteLinkActions({ quoteId, link, canWithdraw }: { quoteId: string; link: string; canWithdraw: boolean }) {
  const t = useT("requests");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`link-${quoteId}`}>{t("detail.quoteLink")}</Label>
        <Input id={`link-${quoteId}`} className="h-11" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast.success(t("detail.copied"));
          }}
        >
          <CopyIcon aria-hidden />
          {t("detail.copyLink")}
        </Button>
        {canWithdraw && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await withdrawQuote(quoteId);
              setBusy(false);
              if (res.success) router.refresh();
              else toast.error(res.error);
            }}
          >
            <UndoIcon aria-hidden />
            {t("detail.withdraw")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function DeclineRequestButton({ requestId }: { requestId: string }) {
  const t = useT("requests");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11">
          {t("detail.decline")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("detail.declineTitle")}</DialogTitle>
          <DialogDescription>{t("detail.declineReason")}</DialogDescription>
        </DialogHeader>
        <Textarea aria-label={t("detail.declineReason")} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
            {t("detail.keep")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await declineRequest(requestId, reason);
              setBusy(false);
              if (res.success) {
                setOpen(false);
                router.refresh();
              } else {
                setError(res.error);
              }
            }}
          >
            {t("detail.declineConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
