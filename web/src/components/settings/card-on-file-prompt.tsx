"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateBusinessSettings } from "@/actions/policies";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";

/**
 * Prompt shown on Settings → Billing once Stripe is connected for a business that
 * turned off "require card on file" when it skipped Stripe during onboarding.
 * Flipping the policy back on removes the prompt (the server condition that
 * renders it becomes false), so no explicit dismiss is needed.
 */
export function CardOnFilePrompt() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleEnable() {
    startTransition(async () => {
      const result = await updateBusinessSettings({ requireCardOnFile: 1 });
      if (!result.success) {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? result.error.message
            : "Failed to update policy",
        );
        return;
      }
      toast.success("Bookings now require a card on file.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Require a card on file?</CardTitle>
        <CardDescription>
          Stripe is connected — want to require a card on file for bookings
          again? You turned this off during setup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full sm:w-auto"
          onClick={handleEnable}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 size-4" />
              Require card on file
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
