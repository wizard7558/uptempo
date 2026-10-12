import { getT } from "@/lib/terms/server";
import { verifyActionToken } from "@/lib/email/tokens";
import { getFormResponseForToken } from "@/actions/forms";
import { FormSubmission } from "./form-submission";

export default async function FormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT("booking");
  const payload = verifyActionToken(token);

  if (!payload || payload.action !== "form" || !payload.formResponseId) {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Link Expired</h1>
          <p className="text-[var(--ink-soft)]">
            {t("formsPage.linkExpired")}
          </p>
        </div>
      </div>
    );
  }

  const data = await getFormResponseForToken(token);

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Form Not Found</h1>
          <p className="text-[var(--ink-soft)]">
            We could not find this form. It may have been removed.
          </p>
        </div>
      </div>
    );
  }

  if (data.alreadySubmitted) {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Form Already Completed</h1>
          <p className="text-[var(--ink-soft)]">
            Thank you! This form has already been submitted. No further action
            is needed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
      <div className="mx-auto max-w-lg w-full px-4 py-12">
        <h1 className="display text-4xl mb-2 text-[var(--ink)]">{data.formName}</h1>
        {data.formDescription && (
          <p className="text-[var(--ink-soft)] mb-6">{data.formDescription}</p>
        )}
        <FormSubmission
          formResponseId={payload.formResponseId}
          token={token}
          fields={data.fields}
          formName={data.formName}
          consent={data.consent}
        />
      </div>
    </div>
  );
}
