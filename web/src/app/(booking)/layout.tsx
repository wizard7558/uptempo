import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserCircle } from "lucide-react";
import { getBookingBrandingCached } from "@/lib/booking/cached-lookups";
import { bookingThemeFromRow, bookingThemeStyle } from "@/lib/booking/theme";
import { AppProviders } from "@/components/app-providers";
import { PoweredByBadge } from "@/components/booking-public/powered-by-badge";
import { NativeTabBar } from "@/components/booking-public/native-tab-bar";
import { getTenantSlugOrNull } from "@/lib/tenant/context";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { TermsProvider } from "@/lib/terms/client";
import { getT, getTerms } from "@/lib/terms/server";
import { SourceLink } from "@/components/layout/source-link";

function BookingHeader({
  accountLink,
  center,
}: {
  accountLink: ReactNode | null;
  center: ReactNode | null;
}) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 sm:px-6 md:max-w-xl lg:max-w-2xl xl:max-w-3xl">
      <header className="pb-3 pt-3 sm:pb-5">
        <div className="mb-3 h-px w-full bg-[var(--line)] animate-line" />
        {accountLink ? (
          <div className="flex flex-col items-center gap-2 sm:gap-3">
            {center}
            {accountLink}
          </div>
        ) : (
          center
        )}
      </header>
    </div>
  );
}

export default async function BookingGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const slug = await getTenantSlugOrNull();
  // Resolve the tenant from the registry before any tenant-schema query.
  if (slug && !(await isTenantProvisioned(slug))) notFound();
  // Terms follow the tenant whose page is shown: same slug this layout resolves.
  const terms = await getTerms(slug);
  const t = await getT("booking", slug);
  const bookingClientId = await getBookingSession();

  const accountLink = bookingClientId ? (
    <Link
      href="/account"
      // The native shells have an Account tab in the bottom bar — hide the
      // duplicate header link there (see NativeBridge / globals.css).
      data-native-hidden
      className="editorial-link inline-flex shrink-0 items-center gap-1.5 text-xs"
    >
      <UserCircle className="size-4 shrink-0" aria-hidden />
      My Account
    </Link>
  ) : null;

  // No tenant context — render children without branding
  if (!slug) {
    return (
      <AppProviders>
      <TermsProvider terms={terms}>
        <div
          className="light min-h-screen bg-background text-foreground"
          data-theme-scope="booking"
        >
          <BookingHeader accountLink={accountLink} center={null} />
          {children}
          <footer className="mx-auto w-full max-w-lg px-4 pb-8 text-center">
            <SourceLink className="text-xs text-muted-foreground" />
          </footer>
          <NativeTabBar />
        </div>
      </TermsProvider>
      </AppProviders>
    );
  }

  // Cached per-tenant (tag-invalidated on branding save) — keeps the shared
  // layout off the DB so the shell of every booking page flushes immediately.
  const branding = await getBookingBrandingCached(slug);
  const theme = bookingThemeStyle(bookingThemeFromRow(branding));

  const showLogo = !!branding?.logoUrl;
  const showPoweredBy = branding?.showPoweredBy !== 0;

  return (
    <AppProviders>
    <TermsProvider terms={terms}>
    <div
      className={`${theme.className} min-h-screen bg-background text-foreground`}
      data-theme-scope="booking"
      data-density={theme.dataDensity}
      style={theme.style}
    >
      <BookingHeader
        accountLink={accountLink}
        center={
          showLogo ? (
            <div className="flex justify-center px-1 pt-1 sm:pt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding!.logoUrl!}
                alt={t("layout.logoAlt")}
                className="h-28 w-auto max-w-full object-contain sm:h-32 md:h-36"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null
        }
      />
      {children}
      <PoweredByBadge show={showPoweredBy} />
      <footer className="mx-auto w-full max-w-lg px-4 pb-8 text-center">
        <SourceLink className="text-xs text-muted-foreground" />
      </footer>
      <NativeTabBar />
    </div>
    </TermsProvider>
    </AppProviders>
  );
}
