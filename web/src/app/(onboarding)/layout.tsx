import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import { SignOutButton } from "./sign-out-button";
import { listUserMemberships } from "@/actions/team";
import { OnboardingSalonSwitcher } from "@/components/onboarding/salon-switcher";
import { NativeBridge } from "@/components/native/native-bridge";
import { TermsProvider } from "@/lib/terms/client";
import { getTerms } from "@/lib/terms/server";
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
    <ThemeProvider>
    <TermsProvider terms={terms}>
    <div className="min-h-screen bg-background">
      <NativeBridge />
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[var(--ivory)]/90 px-6 backdrop-blur-md supports-[backdrop-filter]:bg-[var(--ivory)]/80">
        <div className="flex items-center gap-3">
          <Image src="/uptempo.svg" alt="Uptempo" width={28} height={28} />
          <span className="text-xs font-medium tracking-[0.16em] text-[var(--ink)]">
            Uptempo
          </span>
        </div>
        <div className="flex items-center gap-2">
          {memberships.length > 1 && (
            <OnboardingSalonSwitcher
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
  );
}
