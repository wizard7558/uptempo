import Link from "next/link";
import messages from "@/i18n/messages/en.json";

const copy = messages.settings.billing;

export function BillingSwitchNotice({
  noticeSentAt,
  switchAt,
}: {
  noticeSentAt: Date | null;
  switchAt: Date | null;
}) {
  if (!noticeSentAt || !switchAt || switchAt.getTime() <= Date.now()) {
    return null;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(switchAt);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <span>{copy.switchNotice.replace("{date}", date)}</span>
      <Link
        href="/pricing"
        className="font-medium underline underline-offset-2 hover:no-underline"
      >
        {copy.switchDetails}
      </Link>
    </div>
  );
}
