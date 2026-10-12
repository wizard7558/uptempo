import { getPaymentMethodSettings } from "@/actions/policies";
import { PaymentMethodsForm } from "@/components/settings/payment-methods-form";

export default async function PaymentMethodsPage() {
  const settings = await getPaymentMethodSettings();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payment Methods</h1>
        <p className="text-muted-foreground mt-1">
          Control which payment methods clients can use during checkout. Card
          payments are always available.
        </p>
      </div>

      <PaymentMethodsForm initialSettings={settings} />
    </div>
  );
}
