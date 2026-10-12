"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/terms/client";

const TABS = [
  { href: "/analytics", labelKey: "adminSidebar.reportsOverview" },
  { href: "/analytics/revenue", labelKey: "adminSidebar.reportsRevenue" },
  { href: "/analytics/services", labelKey: "adminSidebar.reportsServiceAnalytics" },
] as const;

export function ReportsTabs() {
  const pathname = usePathname() ?? "";
  const t = useT("nav");

  return (
    <nav aria-label={t("reports")} className="flex flex-wrap gap-2 px-6 pt-6">
      {TABS.map((tab) => {
        const active =
          tab.href === "/analytics"
            ? pathname === "/analytics"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                : "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium text-foreground hover:bg-muted"
            }
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
