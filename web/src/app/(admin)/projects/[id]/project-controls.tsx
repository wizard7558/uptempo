"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SaveIcon, SendIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/lib/terms/client";
import {
  sendDesignForApproval,
  updateProject,
  uploadProjectDesign,
  type ProjectStatus,
} from "@/actions/projects";

const STATUSES: ProjectStatus[] = ["consult", "design", "scheduled", "in_progress", "healing", "touch_up", "complete", "cancelled"];

/** Upload and send buttons for the design section. */
export function DesignActions({ projectId, hasDesign, clientName }: { projectId: string; hasDesign: boolean; clientName: string }) {
  const t = useT("projects");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("upload");
    const form = new FormData();
    form.set("file", file);
    const res = await uploadProjectDesign(projectId, form);
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!res.success) return setError(res.error);
    toast.success(t("uploaded"));
    router.refresh();
  }

  async function onSend() {
    setError(null);
    setBusy("send");
    const res = await sendDesignForApproval(projectId);
    setBusy(null);
    if (!res.success) return setError(res.error);
    toast.success(t("sentToClient", { name: clientName }));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label={t("uploadDesign")}
          data-testid="design-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => input.current?.click()}>
          <UploadIcon aria-hidden />
          {busy === "upload" ? t("uploading") : t("uploadDesign")}
        </Button>
        <Button type="button"  variant="default" disabled={busy !== null || !hasDesign} onClick={() => void onSend()}>
          <SendIcon aria-hidden />
          {busy === "send" ? t("sending") : t("sendApproval")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

type EditableProject = {
  id: string;
  staffId: string | null;
  title: string;
  placement: string | null;
  size: string | null;
  estSessions: number;
  quotedTotalCents: number | null;
  notes: string | null;
  status: ProjectStatus;
};

/** The status Select and its Save button. */
export function ProjectStatusForm({ project }: { project: EditableProject }) {
  const t = useT("projects");
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    setBusy(true);
    const res = await updateProject({ ...project, status });
    setBusy(false);
    if (!res.success) return setError(res.error);
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="max-w-xs space-y-1">
        <Label htmlFor="project-status">{t("statusLabel")}</Label>
        <NativeSelect id="project-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button"  variant="default" disabled={busy} onClick={() => void onSave()}>
        <SaveIcon aria-hidden />
        {busy ? t("saving") : t("saveStatus")}
      </Button>
    </section>
  );
}
