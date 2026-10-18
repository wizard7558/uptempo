"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { openBillingPortal } from "@/actions/hosted-billing";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native/client";

type RuntimeHost = "unknown" | "native" | "web";

export function ManageBillingButton({
  label,
  nativeNotice,
}: {
  label: string;
  nativeNotice: string;
}) {
  const [host, setHost] = useState<RuntimeHost>("unknown");
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    setHost(isNativeApp() ? "native" : "web");
  }, []);

  function open() {
    if (host !== "web" || isNativeApp()) return;
    startTransition(async () => {
      const result = await openBillingPortal();
      if ("url" in result) {
        setRedirecting(true);
        window.location.assign(result.url);
      } else {
        toast.error(result.error);
      }
    });
  }

  if (host !== "web") {
    return <p className="text-sm text-muted-foreground">{nativeNotice}</p>;
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={open}
      disabled={pending || redirecting}
    >
      {label}
    </Button>
  );
}
