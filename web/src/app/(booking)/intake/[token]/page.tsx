import { getT } from "@/lib/terms/server";
import { getIntakeByToken } from "@/actions/policies";
import { IntakeForm } from "./intake-form";

export const dynamic = "force-dynamic";

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT("booking");
  const intake = await getIntakeByToken(token);

  if (!intake) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        {t("intakePage.invalidLink")}
      </div>
    );
  }

  if (intake.signedAt) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink)]">
        <h1 className="display text-3xl mb-2">All set</h1>
        <p className="text-[var(--ink-soft)]">
          You&apos;ve already signed and saved a card with {intake.salonName}.
          See you soon!
        </p>
      </div>
    );
  }

  return (
    <IntakeForm
      token={token}
      clientName={intake.clientName}
      salonName={intake.salonName}
      logoUrl={intake.logoUrl}
      policyText={intake.policyText}
    />
  );
}
