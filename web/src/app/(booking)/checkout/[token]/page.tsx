import { getT } from "@/lib/terms/server";
import { verifyActionToken } from "@/lib/email/tokens";
import { getCheckoutDataPublic } from "@/actions/checkout";
import { CheckoutForm } from "./checkout-form";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT("booking");
  const payload = verifyActionToken(token);

  if (!payload || payload.action !== "checkout") {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Link Expired</h1>
          <p className="text-[var(--ink-soft)]">
            {t("checkoutPage.linkExpired")}
          </p>
        </div>
      </div>
    );
  }

  const data = await getCheckoutDataPublic(payload.appointmentId, token);

  if ("error" in data && data.error) {
    const isCompleted = data.error.includes("completed");
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">
            {isCompleted ? "Already Paid" : "Not Available"}
          </h1>
          <p className="text-[var(--ink-soft)]">
            {isCompleted
              ? "This appointment has already been paid for. No further action is needed."
              : "This appointment is no longer available for checkout."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
      <div className="mx-auto max-w-lg w-full px-4 py-12">
        <CheckoutForm
          token={token}
          appointmentId={data.appointment.id}
          client={{
            id: data.client.id,
            name: data.client.name,
            hasCardOnFile: data.client.hasCardOnFile,
            stripeCustomerId: data.client.stripeCustomerId,
            stripePaymentMethodId: data.client.stripePaymentMethodId,
          }}
          // A visit paid with a credit owes only a tip: the form's own sums start from zero.
          paidWithCredit={data.creditCovered}
          services={data.services.map((s) => ({
            serviceName: s.serviceName,
            priceCents: data.creditCovered ? 0 : s.priceCents,
          }))}
          totalCents={data.creditCovered ? 0 : data.totalCents}
          storedValueBalanceCents={data.creditCovered ? 0 : data.storedValueBalanceCents}
          storedValueAppliedCents={data.creditCovered ? 0 : data.storedValueAppliedCents}
          cardChargeCents={data.cardChargeCents}
          memberDiscountPercent={data.creditCovered ? 0 : data.memberDiscountPercent}
          fullBbDiscountedTotalCents={data.creditCovered ? 0 : data.fullBbDiscountedTotalCents}
          eligibleForFullBb={data.creditCovered ? false : data.eligibleForFullBb}
        />
      </div>
    </div>
  );
}
