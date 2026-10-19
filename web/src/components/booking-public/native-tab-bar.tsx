"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarPlus, ShoppingBag, UserCircle } from "lucide-react";
import { isNativeApp } from "@/lib/native/client";

const SLUG_COOKIE = "uptempo_last_salon";
const SLUG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Business-facing surfaces that get the tab bar. Transactional deep-link pages
 * (forms, intake, cancel, reschedule, checkout, aftercare, quiz) stay
 * chromeless.
 */
const TAB_SURFACES = /^\/(?:book|store|subscribe)\/|^\/(?:account|discover)(?:\/|$)/;

function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:book|store|subscribe)\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function readSlugCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)uptempo_last_salon=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Native-app-only bottom tab bar (Book / Shop / Account) so the client shell
 * feels like a phone app instead of a website. Remembers the last business the
 * client visited (cookie, also set server-side on OTP verification) so every
 * tab is business-scoped, and bounces the app's cold start at /discover straight
 * to that business. Renders nothing on the plain web.
 */
export function NativeTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement | null>(null);
  const [native, setNative] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  // Optimistic highlight: the tapped tab lights up immediately instead of
  // waiting for the server round-trip to commit the navigation.
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  const showTabBar = native && TAB_SURFACES.test(pathname);

  // Publish the bar's measured height so bottom-anchored UI (the booking
  // steps' sticky Continue footers) can sit above it instead of behind it:
  // they use bottom-[var(--app-tab-bar-offset,0px)], falling back to 0 on
  // the plain web. --app-footer-safe-pad zeroes their own safe-area padding
  // since the bar already covers the home indicator.
  useEffect(() => {
    if (!showTabBar || !navRef.current) return;
    const nav = navRef.current;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--app-tab-bar-offset", `${nav.offsetHeight}px`);
      root.style.setProperty("--app-footer-safe-pad", "0px");
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(nav);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--app-tab-bar-offset");
      root.style.removeProperty("--app-footer-safe-pad");
    };
  }, [showTabBar]);

  // Remember the business from any business-scoped path; fall back to the cookie.
  useEffect(() => {
    const fromPath = slugFromPath(pathname);
    if (fromPath) {
      document.cookie = `${SLUG_COOKIE}=${encodeURIComponent(fromPath)};path=/;max-age=${SLUG_COOKIE_MAX_AGE};samesite=lax`;
      setSlug(fromPath);
    } else {
      setSlug(readSlugCookie());
    }
  }, [pathname]);

  // Cold start lands on /discover (the shell's fixed URL). If we already know
  // the client's business, go straight there — once per app session, so tapping
  // through to Discover on purpose still works.
  useEffect(() => {
    if (!native || pathname !== "/discover") return;
    const remembered = readSlugCookie();
    if (!remembered) return;
    if (sessionStorage.getItem("uptempo.discoverRedirected")) return;
    sessionStorage.setItem("uptempo.discoverRedirected", "1");
    router.replace(`/book/${remembered}`);
  }, [native, pathname, router]);

  if (!showTabBar) return null;

  const tabs = [
    {
      label: "Book",
      href: slug ? `/book/${slug}` : "/discover",
      icon: CalendarPlus,
      active: pathname.startsWith("/book/") || pathname.startsWith("/discover"),
    },
    {
      label: "Shop",
      href: slug ? `/store/${slug}` : "/discover",
      icon: ShoppingBag,
      active: pathname.startsWith("/store/"),
    },
    {
      label: "Account",
      href: "/account",
      icon: UserCircle,
      active: pathname.startsWith("/account") || pathname.startsWith("/subscribe/"),
    },
  ];

  return (
    <>
      {/* In-flow spacer so page content scrolls clear of the fixed bar. */}
      <div className="h-[var(--app-tab-bar-offset,5rem)]" aria-hidden />
      <nav
        ref={navRef}
        aria-label="App navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-[var(--background)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {tabs.map((tab) => {
            const active = pendingHref ? pendingHref === tab.href : tab.active;
            return (
              <Link
                key={tab.label}
                href={tab.href}
                prefetch={true}
                onClick={() => setPendingHref(tab.href)}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 select-none flex-col items-center gap-1 py-2.5 transition-opacity [touch-action:manipulation] active:opacity-60 ${
                  active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"
                }`}
              >
                <tab.icon className="size-5" aria-hidden strokeWidth={active ? 2.2 : 1.6} />
                <span className="text-xs font-medium uppercase tracking-[0.2em]">
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
