"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

/**
 * Mobile navigation trigger.
 *
 * The shadcn/ui Sidebar component handles the actual mobile drawer (Sheet)
 * behavior internally -- when on mobile viewports, the SidebarTrigger opens
 * the sidebar as a slide-out sheet. This component provides the visible
 * hamburger button for mobile screens.
 */
export function MobileNav() {
  return (
    <div className="flex items-center gap-2 md:hidden">
      <SidebarTrigger />
      <Separator orientation="vertical" className="!h-4" />
    </div>
  );
}
