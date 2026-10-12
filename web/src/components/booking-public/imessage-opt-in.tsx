"use client";

import { Button } from "@/components/ui/button";
import { MessageCircleIcon } from "lucide-react";
import { isNativeApp, openInSystemBrowser } from "@/lib/native/client";

// Stable opt-in link for the platform's shared LoopMessage sender. Inlined at
// build by Next when set; the whole component renders nothing when it's unset.
const OPT_IN_URL = process.env.NEXT_PUBLIC_LOOPMESSAGE_OPTIN_URL;

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * "Get reminders by iMessage" opt-in. Apple/iMessage requires the recipient to
 * start a conversation with our sender before we can message them, so this opens
 * the LoopMessage opt-in flow (a pre-filled Message). On mobile and in the native
 * app it opens Messages directly; on desktop it opens in a new tab.
 *
 * The copy states clearly what they'll receive and why the extra step exists.
 */
export function ImessageOptIn({ salonName }: { salonName: string }) {
  if (!OPT_IN_URL) return null;

  async function handleOptIn() {
    const url = OPT_IN_URL!;
    if (isNativeApp()) {
      // Native shell → system browser, which hands the imessage link to Messages.
      await openInSystemBrowser(url);
    } else if (isMobile()) {
      // Mobile web → navigate so the OS opens Messages directly (no blank tab).
      window.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="space-y-2 border border-[var(--line)] p-4">
      <p className="font-display text-xl font-light text-[var(--ink)]">
        Get reminders by iMessage
      </p>
      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
        Receive appointment confirmations and reminders from {salonName} by
        iMessage. Tapping below opens Messages with a quick pre-filled note to
        send us — that one-time step is how Apple lets us text you. We only send
        appointment-related messages, never marketing, and you can stop anytime.
      </p>
      <Button
        variant="outline"
        
        onClick={handleOptIn}
        className="w-full"
      >
        <MessageCircleIcon className="size-4" />
        Opt in to iMessage reminders
      </Button>
    </div>
  );
}
