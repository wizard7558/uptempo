"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function SignatureUnderline({ className }: { className?: string }) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onChange = () => {
      setPrefersReducedMotion(media.matches);
    };

    onChange();
    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  return (
    <svg
      className={cn(
        "pointer-events-none absolute -bottom-11 left-[-10%] h-16 w-[120%] overflow-visible text-[var(--sand)]",
        className,
      )}
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M 5 20 C 35 5, 65 5, 95 20 C 70 10, 30 15, 10 35 C 35 20, 65 25, 90 50"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(!prefersReducedMotion && "animate-signature")}
        style={
          prefersReducedMotion
            ? undefined
            : { strokeDasharray: 400, strokeDashoffset: 400 }
        }
      />
    </svg>
  );
}
