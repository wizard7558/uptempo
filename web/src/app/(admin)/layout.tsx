import { requireAdminRole } from "@/lib/auth/rbac";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { GlobalSearch, type GlobalSearchNavItem } from "@/components/layout/global-search";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveOnboardingRedirect } from "@/lib/onboarding/gate";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { getOnboardingState } from "@/actions/onboarding";
import { listAllBrokenCalendarConnectionsForTenant } from "@/lib/calendar/tenant-connections";
import { CalendarConnectionBanner } from "@/components/layout/calendar-connection-banner";
import { listAlertsForTenant, getUnreadAlertCountForTenant } from "@/lib/alerts/for-tenant";
import { AlertsBell } from "@/components/layout/alerts-bell";
import { listUserMemberships } from "@/actions/team";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { NavProgress } from "@/components/layout/nav-progress";
import { TermsProvider } from "@/lib/terms/client";
import { getT, getTerms } from "@/lib/terms/server";
import { getEnabledModules } from "@/lib/tenant/modules";
import { NativeBridge } from "@/components/native/native-bridge";
import { ThemeProvider } from "@/components/theme-provider";

function SidebarChromeFallback({
  role,
  tenantSlug,
}: {
  role: string;
  tenantSlug: string | null;
}) {
  return (
    <div className="relative">
      <AdminSidebar role={role} tenantSlug={tenantSlug} />
      <div className="pointer-events-none absolute inset-x-3 top-16 space-y-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

function BannerSkeleton() {
  return (
    <div className="border-b px-4 py-2">
      <Skeleton className="h-5 w-72 max-w-full" />
    </div>
  );
}

async function SidebarMembershipsLoader({
  role,
  tenantSlug,
}: {
  role: string;
  tenantSlug: string | null;
}) {
  const [membershipData, onboardingSteps, enabledModules] = await Promise.all([
    listUserMemberships(),
    tenantSlug ? getOnboardingState(tenantSlug) : Promise.resolve(null),
    tenantSlug ? getEnabledModules(tenantSlug) : Promise.resolve([]),
  ]);

  return (
    <AdminSidebar
      role={role}
      tenantSlug={tenantSlug}
      onboardingSteps={onboardingSteps}
      enabledModules={enabledModules}
      memberships={membershipData.memberships}
      activeTenantSlug={membershipData.activeTenantSlug}
    />
  );
}

async function AlertsBellLoader({ tenantSlug }: { tenantSlug: string | null }) {
  if (tenantSlug == null) return null;
  try {
    const [alerts, unread] = await Promise.all([
      listAlertsForTenant(tenantSlug),
      getUnreadAlertCountForTenant(tenantSlug),
    ]);
    return <AlertsBell initialAlerts={alerts} initialUnread={unread} />;
  } catch (error) {
    // Never let an alerts read break the dashboard chrome.
    console.error("[AlertsBell] failed to load alerts:", error);
    return null;
  }
}

async function CalendarConnectionBannerLoader({
  tenantSlug,
}: {
  tenantSlug: string | null;
}) {
  const brokenCalendarConnections =
    tenantSlug == null
      ? []
      : await listAllBrokenCalendarConnectionsForTenant(tenantSlug);
  return <CalendarConnectionBanner items={brokenCalendarConnections} />;
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, tenantSlug } = await requireAdminRole();
  const terms = await getTerms(tenantSlug);
  const tNav = await getT("nav", tenantSlug);

  // Quick-nav destinations for the header search, filtered to what this role
  // can actually reach. Passed to the client palette so it never offers a page
  // the user can't open.
  const quickNavConfig: (GlobalSearchNavItem & { permission: Permission })[] = [
    { label: tNav("schedule"), href: "/schedule", permission: "manage_schedule" },
    { label: tNav("clients"), href: "/clients", permission: "manage_clients" },
    { label: tNav("services"), href: "/services", permission: "manage_services" },
    { label: tNav("revenue"), href: "/analytics/revenue", permission: "view_revenue" },
    { label: tNav("analytics"), href: "/analytics/services", permission: "view_revenue" },
    { label: tNav("settings"), href: "/settings", permission: "manage_settings" },
  ];
  const quickNav: GlobalSearchNavItem[] = quickNavConfig
    .filter((item) => hasPermission(role, item.permission))
    .map(({ label, href }) => ({ label, href }));
  const canSearchClients = hasPermission(role, "manage_clients");

  // Portal gate: a salon that hasn't launched only exposes the onboarding
  // wizard (owners/admins) or a holding page (staff). Launched tenants are
  // never gated; this reads the same cached state the sidebar loader uses.
  if (tenantSlug) {
    const onboardingState = await getOnboardingState(tenantSlug);
    const gateRedirect = resolveOnboardingRedirect(onboardingState, role);
    if (gateRedirect) redirect(gateRedirect);
  }

  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get("sidebar_state")?.value;
  /** `null` = no cookie: client compacts sub-xl widths after mount without persisting until user toggles. */
  const savedOpenPreference =
    sidebarCookie === undefined ? null : sidebarCookie !== "false";
  const defaultOpen =
    sidebarCookie === undefined ? true : sidebarCookie !== "false";

  return (
    <ThemeProvider>
    <TermsProvider terms={terms}>
    <SidebarProvider
      defaultOpen={defaultOpen}
      savedOpenPreference={savedOpenPreference}
    >
      <Suspense
        fallback={
          <SidebarChromeFallback role={role} tenantSlug={tenantSlug} />
        }
      >
        <SidebarMembershipsLoader role={role} tenantSlug={tenantSlug} />
      </Suspense>
      <SidebarInset>
        <NavProgress />
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1 size-11" />
          <div className="ml-auto flex items-center gap-2">
            <GlobalSearch canSearchClients={canSearchClients} quickNav={quickNav} />
            <Suspense fallback={null}>
              <AlertsBellLoader tenantSlug={tenantSlug} />
            </Suspense>
          </div>
        </header>
        <Suspense fallback={<BannerSkeleton />}>
          <CalendarConnectionBannerLoader tenantSlug={tenantSlug} />
        </Suspense>
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto min-h-0 w-full max-w-[1600px]">{children}</div>
        </div>
      </SidebarInset>
      <NativeBridge />
    </SidebarProvider>
    </TermsProvider>
    </ThemeProvider>
  );
}
