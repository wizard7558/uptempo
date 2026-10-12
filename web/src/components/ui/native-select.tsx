import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A plain browser select. Used where people on phones fill in a form: the
 * system picker is large, familiar and works with every screen reader.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input min-h-11 w-full min-w-0 rounded-lg border bg-transparent px-3 text-base shadow-xs outline-none md:text-sm",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
