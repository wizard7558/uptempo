"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ClientSearch } from "@/components/booking/client-search";
import { useT } from "@/lib/terms/client";
import { dollarsToCents } from "@/lib/requests/fields";
import { createProject } from "@/actions/projects";

type PickedClient = { id: string; name: string; email: string | null; phone: string | null };

export function NewProjectDialog() {
  const t = useT("projects");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [title, setTitle] = useState("");
  const [placement, setPlacement] = useState("");
  const [size, setSize] = useState("");
  const [sessions, setSessions] = useState("3");
  const [quoted, setQuoted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    const estSessions = Number.parseInt(sessions, 10);
    const quotedTotalCents = quoted.trim() ? dollarsToCents(quoted) : null;
    if (!client) return setError(t("pickCustomer"));
    if (!title.trim() || !Number.isInteger(estSessions) || estSessions < 1 || estSessions > 50 || (quoted.trim() && quotedTotalCents === null)) {
      return setError(t("errors.invalid"));
    }
    setBusy(true);
    const res = await createProject({
      clientId: client.id,
      title,
      placement,
      size,
      estSessions,
      quotedTotalCents,
    });
    setBusy(false);
    if (!res.success) return setError(res.error);
    setOpen(false);
    router.push(`/projects/${res.id}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button"  variant="default">
          <PlusIcon aria-hidden />
          {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("colCustomer")}</Label>
            <ClientSearch selectedClient={client} onSelect={setClient} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-title">{t("fieldTitle")}</Label>
            <Input id="project-title" className="h-11" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="project-placement">{t("placement")}</Label>
              <Input id="project-placement" className="h-11" value={placement} onChange={(e) => setPlacement(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-size">{t("size")}</Label>
              <Input id="project-size" className="h-11" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-sessions">{t("sessions")}</Label>
              <Input id="project-sessions" className="h-11" type="number" min={1} max={50} value={sessions} onChange={(e) => setSessions(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-quoted">{t("quotedTotal")}</Label>
              <div className="flex items-center gap-2">
                <span aria-hidden>$</span>
                <Input id="project-quoted" className="h-11" inputMode="decimal" value={quoted} onChange={(e) => setQuoted(e.target.value)} />
              </div>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button"  variant="default" disabled={busy} onClick={() => void onSave()}>
            <SaveIcon aria-hidden />
            {busy ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
