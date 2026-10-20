"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isNativeApp } from "@/lib/native/client";
import { registerNativePush } from "@/lib/native/push-register";
import {
  handleNativeDeepLinks,
  type NativeLinkCleanup,
} from "@/lib/native/links";

function NativeNavigationObserver({
  linkCleanupRef,
}: {
  linkCleanupRef: { current: NativeLinkCleanup | null };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    linkCleanupRef.current?.navigationCompleted();
  }, [linkCleanupRef, pathname, search]);

  return null;
}

/**
 * Mounts Capacitor integrations for the native shells. All listeners and
 * pending work are cleaned up when the app area unmounts or React remounts it.
 */
export function NativeBridge() {
  const router = useRouter();
  const linkCleanupRef = useRef<NativeLinkCleanup | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;

    document.documentElement.classList.add("is-native");
    const lifecycle = new AbortController();
    const stopPush = registerNativePush(lifecycle.signal);
    const stopLinks = handleNativeDeepLinks(lifecycle.signal, {
      navigate: (path) => router.push(path),
    });
    linkCleanupRef.current = stopLinks;

    return () => {
      lifecycle.abort();
      stopPush();
      stopLinks();
      if (linkCleanupRef.current === stopLinks) {
        linkCleanupRef.current = null;
      }
      document.documentElement.classList.remove("is-native");
    };
  }, [router]);

  return (
    <Suspense fallback={null}>
      <NativeNavigationObserver linkCleanupRef={linkCleanupRef} />
    </Suspense>
  );
}
