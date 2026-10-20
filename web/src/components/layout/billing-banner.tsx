import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import messages from "@/i18n/messages/en.json";

const copy = messages.settings.billing;

const BANNER_TEXT: Record<string, string> = {
  past_due: copy.bannerPastDue,
  unpaid: copy.bannerPastDue,
  paused: copy.bannerPaused,
  canceled: copy.bannerCanceled,
};

export function isBillingBannerStatus(status: string | null | undefined): boolean {
  return status != null && Object.hasOwn(BANNER_TEXT, status);
}

export function BillingBanner({ status }: { status: string | null }) {
  if (!status || !isBillingBannerStatus(status)) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 break-words">
        {BANNER_TEXT[status]}{" "}
        <Link
          href="/settings/billing"
          className="underline underline-offset-2 hover:no-underline"
        >
          {copy.manageBilling}
        </Link>
      </span>
    </div>
  );
}
