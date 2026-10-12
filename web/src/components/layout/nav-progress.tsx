"use client";

import { useLinkStatus } from "next/link";

export function NavProgress() {
  const { pending } = useLinkStatus();

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 transition-opacity duration-200 ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="h-full w-full animate-pulse bg-primary" />
    </div>
  );
}
