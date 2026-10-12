"use client";

import { useRef, useState, useTransition } from "react";
import { submitFormResponse, uploadIdPhoto } from "@/actions/forms";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import type { FormField } from "@/lib/validators/forms";

interface FormSubmissionProps {
  formResponseId: string;
  /** The signed link token from the page address; the ID upload proves it with this. */
  token: string;
  fields: FormField[];
  formName: string;
  /** Set for consent forms: the page asks for a date of birth, prefilled from the client's record. */
  consent?: { requiresId: boolean; dob: string | null; idRetentionDays: number } | null;
}

export function FormSubmission({
  formResponseId,
  token,
  fields,
  formName,
  consent,
}: FormSubmissionProps) {
  const tc = useT("consent");
  const [dob, setDob] = useState(consent?.dob ?? "");
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [idName, setIdName] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [responses, setResponses] = useState<
    Record<string, string | boolean | null>
  >(() => {
    const initial: Record<string, string | boolean | null> = {};
    for (const field of fields) {
      if (field.type === "checkbox" || field.type === "signature") {
        initial[field.id] = false;
      } else {
        initial[field.id] = "";
      }
    }
    return initial;
  });

  const allRequiredFilled = fields.every((field) => {
    if (!field.required) return true;
    const value = responses[field.id];
    if (value === undefined || value === null || value === "") return false;
    if (typeof value === "boolean" && !value) return false;
    return true;
  });

  async function handleIdFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setIdError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await uploadIdPhoto(formResponseId, token, body);
      if (result.success) setIdName(result.fileName);
      else setIdError(result.error);
    } catch {
      setIdError(tc("uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await submitFormResponse({
        formResponseId,
        token,
        responses,
        ...(consent ? { dob } : {}),
      });

      if (result.success) {
        setSubmitted(true);
      } else {
        toast.error(result.error || "Failed to submit form. Please try again.");
      }
    });
  }

  if (submitted) {
    return (
      <div className="text-center py-8">
        <h2 className="display text-3xl mb-2 text-[var(--ink)]">
          Form Submitted
        </h2>
        <p className="text-[var(--ink-soft)]">
          Thank you for completing the form. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {consent && (
        <Field htmlFor="consent-dob" label={tc("dob")} required>
          <Field.Input
            id="consent-dob"
            type="date"
            aria-label={tc("dob")}
            autoComplete="bday"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            disabled={isPending}
          />
        </Field>
      )}

      {consent?.requiresId && (
        <div className="space-y-2">
          <input
            ref={fileInput}
            id="consent-id-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void handleIdFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            
            className="w-full"
            disabled={isPending || uploading}
            onClick={() => fileInput.current?.click()}
          >
            {idName ? tc("chooseAnother") : tc("addId")}
          </Button>
          <p className="text-sm text-[var(--ink-soft)]">
            {tc("idHint", { days: consent.idRetentionDays })}
          </p>
          {idName && (
            <p className="text-sm text-[var(--ink)]" role="status">
              {tc("idAdded", { name: idName })}
            </p>
          )}
          {idError && (
            <p className="text-sm text-red-600" role="alert">
              {idError}
            </p>
          )}
        </div>
      )}

      {fields.map((field) => (
        <div key={field.id} className="space-y-2">
          {field.type === "text" && (
            <Field htmlFor={field.id} label={field.label} required={field.required}>
              <Field.Input
                id={field.id}
                placeholder={field.placeholder}
                value={(responses[field.id] as string) ?? ""}
                onChange={(e) =>
                  setResponses((prev) => ({
                    ...prev,
                    [field.id]: e.target.value,
                  }))
                }
                disabled={isPending}
              />
            </Field>
          )}

          {field.type === "date" && (
            <Field htmlFor={field.id} label={field.label} required={field.required}>
              <Field.Input
                id={field.id}
                type="date"
                value={(responses[field.id] as string) ?? ""}
                onChange={(e) =>
                  setResponses((prev) => ({
                    ...prev,
                    [field.id]: e.target.value,
                  }))
                }
                disabled={isPending}
              />
            </Field>
          )}

          {field.type === "checkbox" && (
            <div className="flex items-center gap-3">
              <Checkbox
                id={field.id}
                checked={!!responses[field.id]}
                onCheckedChange={(checked) =>
                  setResponses((prev) => ({
                    ...prev,
                    [field.id]: !!checked,
                  }))
                }
                disabled={isPending}
              />
              <Label htmlFor={field.id} className="cursor-pointer">
                {field.label}
                {field.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
            </div>
          )}

          {field.type === "signature" && (
            <div className="flex items-start gap-3 border border-[var(--line)] p-4 bg-[var(--ivory-raised)]">
              <Checkbox
                id={field.id}
                checked={!!responses[field.id]}
                onCheckedChange={(checked) =>
                  setResponses((prev) => ({
                    ...prev,
                    [field.id]: !!checked,
                  }))
                }
                disabled={isPending}
                className="mt-0.5"
              />
              <Label htmlFor={field.id} className="cursor-pointer text-sm">
                I have read and agree to the above {formName}
                {field.required && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
            </div>
          )}
        </div>
      ))}

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={
          isPending ||
          uploading ||
          !allRequiredFilled ||
          (!!consent && !dob)
        }
        variant="default"
        
      >
        {isPending ? "Submitting..." : "Submit Form"}
      </Button>
    </div>
  );
}
