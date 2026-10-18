import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";

/**
 * Client providers for every signed-in, booking and auth surface: all
 * translation namespaces, tooltips, toasts, and analytics. The public
 * marketing routes use their own lighter provider set (see the marketing
 * layout) so they do not ship this code.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider>
      <PostHogProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </PostHogProvider>
      <Toaster />
    </NextIntlClientProvider>
  );
}
