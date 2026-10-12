"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/native/client";
import {
  registerNativePush,
  handleNativeDeepLinks,
} from "@/lib/native/push-register";

/**
 * Mounts the Capacitor native integrations (push registration + system-browser
 * deep-link return handling) when running inside the iOS shell. Renders nothing
 * and is a no-op on the web. Mounted once per app area (booking + admin layouts).
 *
 * Also stamps `is-native` on <html> so CSS can hide web chrome that the native
 * shells replace (elements marked with data-native-hidden).
 */
export function NativeBridge() {
  useEffect(() => {
    if (isNativeApp()) {
      document.documentElement.classList.add("is-native");
    }
    void handleNativeDeepLinks();
    void registerNativePush();
  }, []);
  return null;
}
