"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/terms/client";
import { approveDesign, type ProjectForClient } from "@/actions/projects";

export function ProjectClient({ slug, token, data }: { slug: string; token: string; data: ProjectForClient }) {
  const t = useT("projects");
  const [approved, setApproved] = useState(data.approved);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onApprove() {
    setError(null);
    setBusy(true);
    const res = await approveDesign({ slug, token, name });
    setBusy(false);
    if (res.success) setApproved(true);
    else setError(res.error);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{t("public.title")}</h1>
        <p className="text-sm text-[var(--ink-soft)]">
          {data.businessName} - {data.title}
        </p>
      </div>

      {data.designUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.designUrl} alt={t("designAlt", { title: data.title })} className="w-full border border-[var(--line)] object-contain" />
      ) : (
        <p className="text-center text-base text-[var(--ink)]">{t("public.noDesign")}</p>
      )}

      {data.designUrl &&
        (approved ? (
          <p role="status" className="flex items-center justify-center gap-2 text-base font-medium text-[var(--ink)]">
            <CheckIcon aria-hidden className="h-5 w-5" />
            {t("public.approved")}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="approve-name">{t("public.typeName")}</Label>
              <Input
                id="approve-name"
                className="h-11"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="button"  variant="default" className="w-full" disabled={busy} onClick={() => void onApprove()}>
              <CheckIcon aria-hidden />
              {busy ? t("public.approving") : t("public.approve")}
            </Button>
          </div>
        ))}
    </div>
  );
}
