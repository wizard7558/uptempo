"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { setupConnectAccount, createOnboardingUrl } from "@/actions/connect";
import { isNativeApp, openInSystemBrowser } from "@/lib/native/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ConnectStatus =
  | { connected: false }
  | {
      connected: true;
      accountId: string;
      detailsSubmitted: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
    };

export function BillingStatus({ status }: { status: ConnectStatus }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams?.get("stripe_setup") === "complete") {
      toast.success("Stripe setup updated. Status will refresh shortly.");
      router.replace("/settings/billing");
    }
  }, [searchParams, router]);

  // Owner admin app: Stripe Connect onboarding is a hosted redirect, so in the
  // native shell open it in the system browser and let the app handle the
  // deep-link return; on web, navigate normally.
  const native = isNativeApp() ? "owner" : undefined;

  async function openUrl(url: string) {
    if (native) {
      await openInSystemBrowser(url);
    } else {
      window.location.href = url;
    }
  }

  async function handleSetup() {
    setLoading(true);
    try {
      const result = await setupConnectAccount({ native });
      if (result.success) {
        await openUrl(result.url);
      } else {
        toast.error(result.error);
        setLoading(false);
      }
    } catch {
      toast.error("Failed to start Stripe setup. Please try again.");
      setLoading(false);
    }
  }

  async function handleContinueSetup() {
    setLoading(true);
    try {
      const result = await createOnboardingUrl({ native });
      await openUrl(result.url);
    } catch {
      toast.error("Failed to create onboarding link. Please try again.");
      setLoading(false);
    }
  }

  // Not connected
  if (!status.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Stripe</CardTitle>
          <CardDescription>
            Connect your Stripe account to receive payouts from client payments.
            Platform fees are automatically deducted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full sm:w-auto" onClick={handleSetup} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 size-4" />
                Set up Stripe
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isFullyConnected = status.chargesEnabled && status.payoutsEnabled;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Stripe Connect</CardTitle>
            <CardDescription className="mt-1">
              Account: {status.accountId.slice(0, 15)}...
            </CardDescription>
          </div>
          {isFullyConnected ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Stripe Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-300 text-amber-700">
              Setup Incomplete
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <StatusRow
            label="Details submitted"
            ok={status.detailsSubmitted}
          />
          <StatusRow
            label="Charges enabled"
            ok={status.chargesEnabled}
          />
          <StatusRow
            label="Payouts enabled"
            ok={status.payoutsEnabled}
          />
        </div>

        {!isFullyConnected && (
          <Button
            className="w-full sm:w-auto"
            onClick={handleContinueSetup}
            disabled={loading}
            variant="outline"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 size-4" />
                Continue Stripe setup
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-5 text-green-600" />
      ) : (
        <AlertCircle className="size-5 text-amber-500" />
      )}
      <span className="text-sm">{label}</span>
    </div>
  );
}
