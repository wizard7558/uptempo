import Link from "next/link";
import { getT } from "@/lib/terms/server";
import { getTenantSlug } from "@/lib/tenant/context";
import { getEnabledModules } from "@/lib/tenant/modules";
import type { ModuleId } from "@/lib/verticals";
import {
  Clock,
  CalendarClock,
  MapPin,
  Users,
  UsersRound,
  UserPlus,
  ShieldCheck,
  Settings2,
  CalendarSync,
  Bell,
  ClipboardList,
  ClipboardCheck,
  SlidersHorizontal,
  HeartPulse,
  CreditCard,
  Wallet,
  Palette,
  Globe,
  PiggyBank,
  ShoppingBag,
  ToggleRight,
  Armchair,
  Ticket,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { isSingleMode } from "@/lib/config/mode";
import { getDomainsProvider } from "@/lib/providers/domains";

type T = (key: string) => string;

type SettingsLink = {
  href: string;
  label: string;
  description: string;
  icon: typeof Settings2;
  /** Hidden from the index when this module is off. */
  module?: ModuleId;
};

const settingsLinks = (t: T): SettingsLink[] => [
  {
    href: "/settings/general",
    label: "General",
    description: t("index.descriptions.general"),
    icon: Settings2,
  },
  {
    href: "/settings/modules",
    label: t("index.cards.features"),
    description: t("index.descriptions.features"),
    icon: ToggleRight,
  },
  {
    href: "/settings/hours",
    label: "Working Hours",
    description: t("index.descriptions.hours"),
    icon: Clock,
  },
  {
    href: "/settings/booking",
    label: t("index.cards.bookingRules"),
    description: t("index.descriptions.bookingRules"),
    icon: CalendarClock,
  },
  {
    href: "/settings/resources",
    label: t("index.cards.resources"),
    description: t("index.descriptions.resources"),
    icon: Armchair,
  },
  {
    href: "/settings/service-areas",
    label: t("index.cards.serviceAreas"),
    description: t("index.descriptions.serviceAreas"),
    icon: MapPin,
    module: "on_site",
  },
  {
    href: "/settings/packages",
    label: t("index.cards.packages"),
    description: t("index.descriptions.packages"),
    icon: Ticket,
    module: "packages",
  },
  {
    href: "/settings/locations",
    label: "Locations",
    description: "Manage where appointments can be booked and worked.",
    icon: MapPin,
  },
  {
    href: "/settings/staff",
    label: t("index.cards.staff"),
    description: t("index.descriptions.staff"),
    icon: Users,
  },
  {
    href: "/settings/team",
    label: "Team",
    description: t("teamPage.description"),
    icon: UsersRound,
  },
  {
    href: "/settings/products",
    label: "Storefront",
    description: "Add and manage the retail products you sell.",
    icon: ShoppingBag,
    module: "storefront",
  },
  {
    href: "/settings/assistants",
    label: "Assistants",
    description: "Manage assistant task types and view assistant roster.",
    icon: UserPlus,
    module: "assistant_tasks",
  },
  {
    href: "/settings/policies",
    label: "Policies",
    description: t("index.descriptions.policies"),
    icon: ShieldCheck,
  },
  {
    href: "/settings/calendars",
    label: "Calendar Connections",
    description:
      "Connect Google, Apple, or Outlook calendars to prevent double-booking.",
    icon: CalendarSync,
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description:
      "Configure booking confirmations, reminders, and email templates.",
    icon: Bell,
  },
  {
    href: "/settings/forms",
    label: "Forms & Waivers",
    description: "Create form templates that auto-send when clients book.",
    icon: ClipboardList,
  },
  {
    href: "/settings/aftercare",
    label: "Aftercare",
    description:
      "Create aftercare instructions that auto-send after appointments.",
    icon: HeartPulse,
    module: "aftercare",
  },
  {
    href: "/settings/checklists",
    label: t("index.cards.checklists"),
    description: t("index.descriptions.checklists"),
    icon: ClipboardCheck,
    module: "attachments",
  },
  {
    href: "/settings/custom-fields",
    label: t("index.cards.customFields"),
    description: t("index.descriptions.customFields"),
    icon: SlidersHorizontal,
  },
  {
    href: "/settings/branding",
    label: "Booking Page Branding",
    description: "Customize colors, logo, and branding on your booking page.",
    icon: Palette,
  },
  {
    href: "/settings/domain",
    label: "Custom Domain",
    description: "Connect a custom domain to your booking page.",
    icon: Globe,
  },
  {
    href: "/settings/payments",
    label: "Payment Methods",
    description: "Control accepted payment methods for client checkout.",
    icon: Wallet,
  },
  {
    href: "/settings/memberships",
    label: t("index.cards.memberships"),
    description: "Monthly membership plans and stored-value credits.",
    icon: PiggyBank,
  },
  {
    href: "/settings/billing",
    label: "Billing & Payouts",
    description: "Connect your Stripe account and manage payment settings.",
    icon: CreditCard,
  },
];

export default async function SettingsPage() {
  const t = await getT("settings");
  const enabled = new Set(await getEnabledModules(await getTenantSlug()));
  const domainsEnabled = getDomainsProvider().enabled;
  const single = isSingleMode();
  const links = settingsLinks(t)
    .filter((l) => {
      if (l.href === "/settings/domain" && !domainsEnabled) return false;
      return !l.module || enabled.has(l.module);
    })
    .map((link) =>
      single && link.href === "/settings/billing"
        ? { ...link, label: "Payments" }
        : link,
    );
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          {t("index.subtitle")}
        </p>
      </div>

      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="h-full cursor-pointer transition-colors hover:bg-accent/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <link.icon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base">{link.label}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {link.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
