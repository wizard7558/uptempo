"use client";

import { useT } from "@/lib/terms/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { switchActiveTenant, type UserMembershipRow } from "@/actions/team";

/**
 * Escape hatch for owners with more than one salon. When a second salon is
 * created the owner is gated into its onboarding wizard; without this they
 * cannot get back to an already-launched salon. Switching activates the chosen
 * membership and sends them to the schedule (past the gate for launched salons).
 */
export function OnboardingSalonSwitcher({
  memberships,
  activeTenantSlug,
}: {
  memberships: UserMembershipRow[];
  activeTenantSlug: string | null;
}) {
  const t = useT("onboarding");
  const router = useRouter();
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const others = memberships.filter((m) => m.tenantSlug !== activeTenantSlug);
  if (others.length === 0) return null;

  async function handleSwitch(nextSlug: string) {
    setSwitchingSlug(nextSlug);
    try {
      const result = await switchActiveTenant(nextSlug);
      if (result.success) {
        router.push("/schedule");
      } else {
        setSwitchingSlug(null);
      }
    } catch {
      setSwitchingSlug(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          
          className="text-xs uppercase tracking-[0.2em]"
          disabled={switchingSlug !== null}
        >
          <Building2 className="mr-2 h-4 w-4" />
          {t("salonSwitcher.switch")}
          <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>{t("salonSwitcher.others")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {others.map((m) => (
          <DropdownMenuItem
            key={m.tenantSlug}
            disabled={switchingSlug !== null}
            onSelect={() => {
              void handleSwitch(m.tenantSlug);
            }}
          >
            <span className="flex flex-col gap-0.5">
              <span>{m.salonName}</span>
              <span className="text-xs capitalize text-muted-foreground">
                {m.role}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
