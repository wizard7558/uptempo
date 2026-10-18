"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, TriangleAlert, Info, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dismissAlert, markAllAlertsRead } from "@/actions/alerts";
import { type AlertView } from "@/lib/alerts/for-tenant";

export function AlertsBell({
  initialAlerts,
  initialUnread,
}: {
  initialAlerts: AlertView[];
  initialUnread: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [isPending, startTransition] = useTransition();

  const alerts = initialAlerts;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread > 0) {
      // Optimistically clear the badge; persist in the background.
      setUnread(0);
      startTransition(async () => {
        await markAllAlertsRead();
        router.refresh();
      });
    }
  }

  function handleDismiss(id: string) {
    startTransition(async () => {
      await dismissAlert(id);
      toast.success("Dismissed");
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Alerts${unread > 0 ? ` (${unread} unread)` : ""}`}
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-4 text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Alerts</p>
        </div>
        {alerts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0">
                  {alert.severity === "warning" ? (
                    <TriangleAlert className="size-4 text-amber-600" />
                  ) : (
                    <Info className="size-4 text-sky-600" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">
                    {alert.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {alert.body}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDismiss(alert.id)}
                  disabled={isPending}
                  aria-label="Dismiss alert"
                  className={cn(
                    "mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isPending && "opacity-50",
                  )}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
