"use client";

import { useMemo, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Calendar,
  Users,
  ListChecks,
  Settings,
  LogOut,
  DollarSign,
  TrendingUp,
  Share2,
  Check,
  Receipt,
  ChevronDown,
  Building2,
  Inbox,
  FolderKanban,
  CalendarRange,
  ListOrdered,
  Hourglass,
  Gift,
  LifeBuoy,
} from "lucide-react";
import { useT } from "@/lib/terms/client";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import type { ModuleId } from "@/lib/verticals";
import { OnboardingChecklist } from "./onboarding-checklist";
import { SourceLink } from "./source-link";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { revokeNativePush } from "@/lib/native/push-register";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserMembershipRow } from "@/actions/team";
import { switchActiveTenant } from "@/actions/team";
import type { OnboardingState } from "@/lib/onboarding/state";
import { ThemeToggle } from "./theme-toggle";

const HELP_MAILTO = "mailto:support@bookuptempo.com";

export interface NavItem {
  /** Key within the `nav` message namespace. */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Shown only while this module is on for the business. */
  module?: ModuleId;
}

export const navItems: NavItem[] = [
  { labelKey: "calendar", href: "/schedule", icon: Calendar, permission: "manage_schedule" },
  { labelKey: "clients", href: "/clients", icon: Users, permission: "manage_clients" },
  { labelKey: "services", href: "/services", icon: ListChecks, permission: "manage_services" },
  { labelKey: "walkIns", href: "/walk-ins", icon: ListOrdered, permission: "manage_schedule", module: "walk_in_queue" },
  { labelKey: "waitlist", href: "/slot-waitlist", icon: Hourglass, permission: "manage_schedule", module: "slot_waitlist" },
  { labelKey: "requests", href: "/requests", icon: Inbox, permission: "manage_clients", module: "requests" },
  { labelKey: "projects", href: "/projects", icon: FolderKanban, permission: "manage_clients", module: "projects" },
  { labelKey: "classes", href: "/classes", icon: CalendarRange, permission: "manage_schedule", module: "classes" },
  { labelKey: "giftCards", href: "/gift-cards", icon: Gift, permission: "view_revenue", module: "gift_cards" },
  { labelKey: "payments", href: "/charges", icon: DollarSign, permission: "view_revenue" },
  { labelKey: "expenses", href: "/expenses", icon: Receipt, permission: "view_revenue" },
  { labelKey: "reports", href: "/analytics", icon: TrendingUp, permission: "view_revenue" },
  { labelKey: "settings", href: "/settings", icon: Settings, permission: "manage_settings" },
];

function itemIsActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NO_MODULES: ModuleId[] = [];

interface AdminSidebarProps {
  role?: string;
  tenantSlug?: string | null;
  memberships?: UserMembershipRow[];
  activeTenantSlug?: string | null;
  onboardingSteps?: OnboardingState | null;
  /** Modules switched on for this business. Items tied to a module are hidden unless listed. */
  enabledModules?: ModuleId[];
}

export function AdminSidebar({
  role,
  tenantSlug,
  memberships = [],
  activeTenantSlug = null,
  onboardingSteps,
  enabledModules = NO_MODULES,
}: AdminSidebarProps = {}) {
  const t = useT("nav");
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { open, isMobile } = useSidebar();
  const [copied, setCopied] = useState(false);
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const currentMembership =
    memberships.find((m) => m.tenantSlug === activeTenantSlug) ??
    memberships[0];
  const displaySalonName = currentMembership?.salonName ?? null;
  const compactSalonLabel = displaySalonName ?? "Scheduling";
  const shareSlug = activeTenantSlug ?? tenantSlug ?? null;
  const showCompactSidebar = !isMobile && !open;

  const visibleItems = useMemo(() => {
    const onForBusiness = navItems.filter(
      (item) => !item.module || enabledModules.includes(item.module),
    );
    if (!role) return onForBusiness; // backwards compat: show all if no role
    return onForBusiness.filter(
      (item) => !item.permission || hasPermission(role, item.permission),
    );
  }, [role, enabledModules]);

  const salonMenuItems = (
    <>
      {memberships.map((m) => (
        <DropdownMenuItem
          key={m.tenantSlug}
          disabled={
            switchingSlug !== null ||
            m.tenantSlug === activeTenantSlug
          }
          onSelect={() => {
            void handleSwitchSalon(m.tenantSlug);
          }}
        >
          <span className="flex flex-col gap-0.5">
            <span>{m.salonName}</span>
            <span className="text-sm capitalize text-muted-foreground">
              {m.role}
            </span>
          </span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          router.push("/create-my-business");
        }}
      >
        <Building2 className="mr-2 size-4" />
        {t("adminSidebar.startNewPlace")}
      </DropdownMenuItem>
    </>
  );

  async function handleSignOut() {
    await revokeNativePush();
    await authClient.signOut();
    router.push("/login");
  }

  async function handleSwitchSalon(nextSlug: string) {
    if (nextSlug === activeTenantSlug) return;
    setSwitchingSlug(nextSlug);
    try {
      const result = await switchActiveTenant(nextSlug);
      if (result.success) {
        router.refresh();
      }
    } finally {
      setSwitchingSlug(null);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {showCompactSidebar ? (
          <div className="flex flex-col items-center gap-2 px-1 py-1">
            <Link
              href="/schedule"
              aria-label="Go to schedule"
              className="flex size-10 items-center justify-center rounded-xl"
            >
              <Image src="/brand/mark.svg" alt="Uptempo" width={32} height={32} className="dark:invert" />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="justify-center rounded-xl"
                  title={compactSalonLabel}
                  aria-label={t("adminSidebar.switchPlaceAria", { name: compactSalonLabel })}
                >
                  <Building2 />
                  <span>{compactSalonLabel}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[12rem]">
                {salonMenuItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                className="min-h-12 h-auto gap-3 rounded-xl px-3 text-[15px]"
              >
                <div>
                  <Link
                    href="/schedule"
                    className="flex shrink-0 items-center"
                    aria-label="Go to schedule"
                  >
                    <Image src="/brand/mark.svg" alt="Uptempo" width={32} height={32} className="dark:invert" />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                    <Link
                      href="/schedule"
                      className="inline-flex min-h-6 items-center font-display font-semibold tracking-[0.12em] text-primary"
                    >
                      Uptempo
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        type="button"
                        aria-label={t("adminSidebar.switchPlaceAria", { name: compactSalonLabel })}
                        className="flex min-h-11 min-w-11 max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground"
                      >
                        <span className="truncate">{compactSalonLabel}</span>
                        <ChevronDown className="size-3 shrink-0 opacity-70" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[12rem]">
                        {salonMenuItems}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sm">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const label = t(item.labelKey);
                return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    className="min-h-11 touch-manipulation gap-3 rounded-lg px-3 text-[15px]"
                    isActive={itemIsActive(item.href, pathname)}
                    tooltip={label}
                  >
                    <Link href={item.href} aria-label={label}>
                      <item.icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {!showCompactSidebar && onboardingSteps ? (
          <div className="px-2 pb-2">
            <OnboardingChecklist steps={onboardingSteps} />
          </div>
        ) : null}
        <SidebarMenu>
          {shareSlug && (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="min-h-11 gap-3 rounded-lg px-3 text-[15px]"
                aria-label={
                  copied
                    ? "Booking link copied to clipboard"
                    : "Copy public booking link to clipboard"
                }
                onClick={() => {
                  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "bookuptempo.com").trim();
                  const url = `https://${rootDomain}/book/${shareSlug}`;
                  navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                tooltip="Copy booking link"
              >
                {copied ? <Check className="text-green-600" /> : <Share2 />}
                <span>{copied ? "Link copied!" : "Share booking link"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              className="min-h-11 gap-3 rounded-lg px-3 text-[15px]"
              aria-label="Sign out"
              onClick={handleSignOut}
              tooltip="Sign out"
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="min-h-11 gap-3 rounded-lg px-3 text-[15px]" tooltip="Source code">
              <SourceLink />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="min-h-11 gap-3 rounded-lg px-3 text-[15px]"
              tooltip={t("adminSidebar.getHelp")}
            >
              <a href={HELP_MAILTO}>
                <LifeBuoy />
                <span>{t("adminSidebar.getHelp")}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ThemeToggle />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
