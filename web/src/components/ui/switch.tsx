"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "group/switch relative inline-flex size-11 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 shadow-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
          "group-data-[state=checked]/switch:bg-primary group-data-[state=unchecked]/switch:bg-input",
          "dark:group-data-[state=unchecked]/switch:bg-input/80",
          size === "sm" ? "h-3.5 w-6" : "h-[1.15rem] w-8"
        )}
      />
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute top-1/2 block -translate-y-1/2 rounded-full bg-background ring-0 transition-[left]",
          "dark:group-data-[state=unchecked]/switch:bg-foreground dark:group-data-[state=checked]/switch:bg-primary-foreground",
          size === "sm"
            ? "left-2.5 size-3 data-[state=checked]:left-5"
            : "left-1.5 size-4 data-[state=checked]:left-5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
