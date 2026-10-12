"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { BrandingSettingsForm } from "@/app/(admin)/settings/branding/client";
import { markOnboardingStepComplete } from "@/actions/onboarding";

/** Mirrors the branding settings row the form expects. */
export interface BrandingSettingsData {
  id: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  fontPreference: string | null;
  brandColor: string;
  fontPairing: string;
  cornerStyle: string;
  density: string;
  colorMode: string;
  showPoweredBy: number;
  createdAt: Date;
  updatedAt: Date;
}

interface BrandingStepProps {
  initialSettings: BrandingSettingsData;
  /** Flag step 5 done in the wizard's local checklist. */
  onMarkComplete: () => void;
  /** Advance to the next step. */
  onContinue: () => void;
  onBack: () => void;
}

export function BrandingStep({
  initialSettings,
  onMarkComplete,
  onContinue,
  onBack,
}: BrandingStepProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSaved() {
    startTransition(async () => {
      const result = await markOnboardingStepComplete("branding");
      if (!result.success) {
        toast.error(result.error ?? "Couldn't save. Please try again.");
        return;
      }
      onMarkComplete();
      router.refresh();
      onContinue();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Make it yours</CardTitle>
        <CardDescription>
          Your logo and colors shape your public booking page. This is optional
          — you can set it up anytime later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <BrandingSettingsForm
          initialSettings={initialSettings}
          onSaved={handleSaved}
        />

        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="ghost" onClick={onBack} disabled={isPending}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <button
            onClick={onContinue}
            disabled={isPending}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
