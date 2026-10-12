"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { verifyConsentId } from "@/actions/forms";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/terms/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";

export interface FormResponseRow {
  id: string;
  formName: string;
  submittedAt: Date | null;
  responses: Record<string, unknown>;
  createdAt: Date;
  /** Set for consent forms: staff-only date of birth and ID details. */
  idCheck: {
    dob: string | null;
    age: number | null;
    hasId: boolean;
    deleted: boolean;
    retentionDays: number | null;
    viewUrl: string | null;
    verifiedAt: Date | null;
    verifiedByName: string | null;
  } | null;
}

function IdCheck({ responseId, check }: { responseId: string; check: NonNullable<FormResponseRow["idCheck"]> }) {
  const tc = useT("consent");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markChecked() {
    setError(null);
    startTransition(async () => {
      const res = await verifyConsentId(responseId);
      if (res.success) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <CardContent className="space-y-2 border-b pb-4 text-sm">
      {check.dob && (
        <p>
          {tc("dobAge", {
            date: format(new Date(`${check.dob}T12:00:00`), "MMM d, yyyy"),
            age: check.age ?? "",
          })}
        </p>
      )}
      <p className="font-medium">
        {check.deleted
          ? tc("idDeleted", { days: check.retentionDays ?? "" })
          : check.hasId
            ? tc("idUploaded")
            : tc("noId")}
      </p>
      {check.viewUrl && (
        <Button asChild variant="outline"  className="min-h-11">
          <a href={check.viewUrl} target="_blank" rel="noopener noreferrer">
            {tc("viewId")}
          </a>
        </Button>
      )}
      {check.hasId && check.verifiedAt ? (
        <p>
          {tc("checkedBy", {
            name: check.verifiedByName ?? "",
            date: format(new Date(check.verifiedAt), "MMM d, yyyy"),
          })}
        </p>
      ) : (
        check.hasId &&
        !check.deleted && (
          <Button type="button"  className="min-h-11" disabled={pending} onClick={markChecked}>
            {tc("markChecked")}
          </Button>
        )
      )}
      {error && (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}
    </CardContent>
  );
}

interface FormResponsesProps {
  formResponses: FormResponseRow[];
}

export function FormResponses({ formResponses }: FormResponsesProps) {
  if (formResponses.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
        <ClipboardList className="mx-auto mb-3 size-10 opacity-40" />
        <p>No forms have been sent to this client yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {formResponses.map((response) => (
        <Card key={response.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{response.formName}</CardTitle>
              {response.submittedAt ? (
                <Badge variant="default">Submitted</Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {response.submittedAt
                ? `Submitted ${format(new Date(response.submittedAt), "MMM d, yyyy 'at' h:mm a")}`
                : `Sent ${format(new Date(response.createdAt), "MMM d, yyyy")}`}
            </p>
          </CardHeader>
          {response.idCheck && <IdCheck responseId={response.id} check={response.idCheck} />}
          {response.submittedAt &&
            response.responses &&
            Object.keys(response.responses).length > 0 && (
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(response.responses).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {key}
                      </span>
                      <span className="text-sm">
                        {typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value ?? "-")}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
        </Card>
      ))}
    </div>
  );
}
