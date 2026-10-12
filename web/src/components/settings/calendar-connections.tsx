"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarIcon,
  Link2Icon,
  Unlink2Icon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
} from "lucide-react";
import {
  getCalendarAuthUrl,
  disconnectCalendar,
  listCalendarsForConnection,
  setCalendarId,
} from "@/actions/calendar-connections";
import type { CalendarPlatform } from "@/lib/calendar/types";
import { isNativeApp, openInSystemBrowser } from "@/lib/native/client";
import { toast } from "sonner";

interface CalendarConnectionData {
  id: string;
  platform: string;
  platformEmail: string | null;
  calendarId: string | null;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: Date | null;
}

interface CalendarConnectionsProps {
  staffId: string;
  initialConnections: CalendarConnectionData[];
}

const PLATFORM_LABELS: Record<string, string> = {
  google_calendar: "Google Calendar",
  microsoft_calendar: "Outlook (legacy — disconnect and use Google)",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <Badge
        variant="outline"
        className="border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      >
        <CheckCircle2Icon className="mr-1 size-3" />
        Active
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive">
        <AlertTriangleIcon className="mr-1 size-3" />
        Error
      </Badge>
    );
  }
  return <Badge variant="secondary">Disconnected</Badge>;
}

export function CalendarConnections({
  staffId,
  initialConnections,
}: CalendarConnectionsProps) {
  const searchParams = useSearchParams();
  const connectedId = searchParams?.get("connected");

  const [connections, setConnections] =
    useState<CalendarConnectionData[]>(initialConnections);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Calendar selection state
  const [selectingCalendar, setSelectingCalendar] = useState<string | null>(
    null,
  );
  const [availableCalendars, setAvailableCalendars] = useState<
    Array<{ id: string; name: string; primary: boolean; accessRole: string }>
  >([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(
    null,
  );
  const [savingCalendar, setSavingCalendar] = useState(false);

  // If we just connected, prompt for calendar selection
  useEffect(() => {
    if (connectedId) {
      handleSelectCalendar(connectedId);
    }
  }, [connectedId]);

  async function handleConnect(platform: CalendarPlatform) {
    // This is the owner-facing admin app. In the native shell, Google refuses
    // embedded WebViews, so open the auth URL in the system browser and let the
    // app handle the deep-link return; on web, navigate normally.
    const native = isNativeApp();
    const url = await getCalendarAuthUrl(
      staffId,
      platform,
      native ? "owner" : undefined,
    );
    if (native) {
      await openInSystemBrowser(url);
    } else {
      window.location.href = url;
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setIsDisconnecting(true);
    try {
      const result = await disconnectCalendar(disconnectTarget);
      if (result.success) {
        setConnections((prev) =>
          prev.filter((c) => c.id !== disconnectTarget),
        );
        toast.success("Calendar disconnected");
      } else {
        toast.error("Failed to disconnect calendar");
      }
    } catch {
      toast.error("Failed to disconnect calendar");
    } finally {
      setIsDisconnecting(false);
      setDisconnectTarget(null);
    }
  }

  async function handleSelectCalendar(connectionId: string) {
    setSelectingCalendar(connectionId);
    setLoadingCalendars(true);
    setSelectedCalendarId(null);

    try {
      const calendars = await listCalendarsForConnection(connectionId);
      setAvailableCalendars(calendars);
      const primary = calendars.find((c) => c.primary);
      if (primary) {
        setSelectedCalendarId(primary.id);
      }
    } catch {
      toast.error("Failed to load calendars");
      setSelectingCalendar(null);
    } finally {
      setLoadingCalendars(false);
    }
  }

  async function handleSaveCalendar() {
    if (!selectingCalendar || !selectedCalendarId) return;
    setSavingCalendar(true);

    try {
      await setCalendarId(selectingCalendar, selectedCalendarId);
      const calendar = availableCalendars.find(
        (c) => c.id === selectedCalendarId,
      );
      setConnections((prev) =>
        prev.map((c) =>
          c.id === selectingCalendar
            ? { ...c, calendarId: selectedCalendarId }
            : c,
        ),
      );
      toast.success(
        `Calendar set to "${calendar?.name || selectedCalendarId}"`,
      );
    } catch {
      toast.error("Failed to set calendar");
    } finally {
      setSavingCalendar(false);
      setSelectingCalendar(null);
    }
  }

  const hasGoogle = connections.some((c) => c.platform === "google_calendar");

  return (
    <div className="space-y-6">
      {/* Existing connections */}
      {connections.length > 0 && (
        <div className="space-y-3">
          {connections.map((conn) => (
            <Card key={conn.id} className="py-4">
              <CardContent className="flex items-center justify-between px-6">
                <div className="flex items-center gap-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <CalendarIcon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {platformLabel(conn.platform)}
                      </span>
                      <StatusBadge status={conn.status} />
                      {conn.calendarId && (
                        <Badge variant="secondary" className="text-xs">
                          <Link2Icon className="mr-1 size-3" />
                          Synced
                        </Badge>
                      )}
                    </div>
                    {conn.platformEmail && (
                      <p className="text-sm text-muted-foreground">
                        {conn.platformEmail}
                      </p>
                    )}
                    {conn.status === "error" && conn.errorMessage && (
                      <p className="text-sm text-destructive">
                        {conn.errorMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {conn.status === "error" &&
                    conn.platform === "google_calendar" && (
                    <Button
                      variant="outline"
                      
                      onClick={() => handleConnect("google_calendar")}
                    >
                      Reconnect
                    </Button>
                  )}
                  {conn.status === "active" && (
                    <Button
                      variant="outline"
                      
                      onClick={() => handleSelectCalendar(conn.id)}
                    >
                      Change calendar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    
                    onClick={() => setDisconnectTarget(conn.id)}
                  >
                    <Unlink2Icon className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {connections.some(
            (c) => c.status === "active" && !c.calendarId,
          ) && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangleIcon className="mr-1 inline size-4" />
              No calendar selected -- bookings won&apos;t appear on your
              external calendar.
            </p>
          )}
        </div>
      )}

      {/* Connect Calendar section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect a Calendar</CardTitle>
          <CardDescription>
            Link an external calendar to sync busy times and push new bookings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 px-6">
          {!hasGoogle && (
            <Button
              variant="outline"
              onClick={() => handleConnect("google_calendar")}
            >
              <CalendarIcon className="mr-2 size-4" />
              Google Calendar
            </Button>
          )}
          {hasGoogle && (
            <p className="text-sm text-muted-foreground">
              Google Calendar is connected.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Disconnect confirmation dialog */}
      <Dialog
        open={!!disconnectTarget}
        onOpenChange={() => setDisconnectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect calendar?</DialogTitle>
            <DialogDescription>
              External events from this calendar will no longer block your
              availability. Any synced busy blocks will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calendar selection dialog */}
      <Dialog
        open={!!selectingCalendar}
        onOpenChange={() => setSelectingCalendar(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select calendar</DialogTitle>
            <DialogDescription>
              New bookings will be pushed to this calendar and busy times will be
              synced from it.
            </DialogDescription>
          </DialogHeader>
          {loadingCalendars ? (
            <div className="flex items-center justify-center py-6">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {availableCalendars.map((cal) => (
                <label
                  key={cal.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="calendarSelection"
                    value={cal.id}
                    checked={selectedCalendarId === cal.id}
                    onChange={() => setSelectedCalendarId(cal.id)}
                    className="size-4 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {cal.name}
                      {cal.primary && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Primary
                        </Badge>
                      )}
                    </p>
                  </div>
                </label>
              ))}
              {availableCalendars.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No writable calendars found. Please check your calendar
                  permissions.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectingCalendar(null)}
            >
              Skip
            </Button>
            <Button
              onClick={handleSaveCalendar}
              disabled={!selectedCalendarId || savingCalendar}
            >
              {savingCalendar && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Select calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
