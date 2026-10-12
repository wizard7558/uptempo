import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

const PLATFORM_LABELS: Record<string, string> = {
  google_calendar: "Google Calendar",
  microsoft_calendar: "Outlook",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function CalendarConnectionBanner({
  items,
}: {
  items: Array<{ staffName: string; platform: string }>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 break-words">
        Calendar connection issue:{" "}
        {items
          .map((c) => `${c.staffName}'s ${platformLabel(c.platform)}`)
          .join(", ")}
        .{" "}
        <Link
          href="/settings/calendars"
          className="underline underline-offset-2 hover:no-underline"
        >
          Reconnect in Settings
        </Link>
      </span>
    </div>
  );
}
