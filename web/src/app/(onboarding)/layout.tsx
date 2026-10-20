import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { SignOutButton } from "./sign-out-button";
import { listUserMemberships } from "@/actions/team";
import { OnboardingBusinessSwitcher } from "@/components/onboarding/business-switcher";
import { TermsProvider } from "@/lib/terms/client";
import { getTerms } from "@/lib/terms/server";
import { AppProviders } from "@/components/app-providers";
import { ThemeProvider } from "@/components/theme-provider";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { memberships, activeTenantSlug } = await listUserMemberships();
  const terms = await getTerms(activeTenantSlug);

  return (
    <AppProviders>
    <ThemeProvider>
    <TermsProvider terms={terms}>
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--ivory)]/90 px-6 backdrop-blur-md supports-[backdrop-filter]:bg-[var(--ivory)]/80">
        <Image src="/brand/wordmark.svg" alt="Uptempo" width={127} height={24} className="dark:invert" />
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <OnboardingBusinessSwitcher
              memberships={memberships}
              activeTenantSlug={activeTenantSlug}
            />
          )}
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
    </TermsProvider>
    </ThemeProvider>
    </AppProviders>
  );
}
