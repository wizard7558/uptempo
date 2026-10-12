"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updatePaymentMethods } from "@/actions/policies";

interface PaymentMethodsFormProps {
  initialSettings: {
    applePayEnabled: number;
    googlePayEnabled: number;
    afterpayEnabled: number;
    cashappEnabled: number;
  };
}

const paymentMethods = [
  {
    key: "applePayEnabled" as const,
    label: "Apple Pay",
    description:
      "One-tap payment on Safari and Apple devices. Requires client to have Apple Pay configured.",
  },
  {
    key: "googlePayEnabled" as const,
    label: "Google Pay",
    description:
      "One-tap payment on Chrome and Android devices. Requires client to have Google Pay configured.",
  },
  {
    key: "afterpayEnabled" as const,
    label: "Afterpay",
    description:
      "Buy now, pay later in 4 installments. Available for services $35 and above.",
  },
  {
    key: "cashappEnabled" as const,
    label: "Cash App Pay",
    description: "Pay using Cash App balance or linked debit card.",
  },
];

export function PaymentMethodsForm({
  initialSettings,
}: PaymentMethodsFormProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);

  function handleToggle(
    key: keyof typeof settings,
    checked: boolean,
  ) {
    setSettings((prev) => ({ ...prev, [key]: checked ? 1 : 0 }));
  }

  async function handleSave() {
    setSaving(true);

    try {
      const result = await updatePaymentMethods(settings);

      if (!result.success) {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? (result.error as { message: string }).message
            : "Failed to update payment methods",
        );
        return;
      }

      toast.success("Payment methods updated");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="space-y-0">
          {paymentMethods.map((method, index) => (
            <div
              key={method.key}
              className={`flex items-center justify-between py-4 ${
                index < paymentMethods.length - 1 ? "border-b" : ""
              }`}
            >
              <div className="space-y-0.5 pr-4">
                <Label htmlFor={method.key} className="text-sm font-medium">
                  {method.label}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {method.description}
                </p>
              </div>
              <Switch
                id={method.key}
                checked={settings[method.key] === 1}
                onCheckedChange={(checked) =>
                  handleToggle(method.key, checked)
                }
              />
            </div>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Card payments are always accepted and cannot be disabled.
      </p>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : "Save Payment Methods"}
      </Button>
    </div>
  );
}
