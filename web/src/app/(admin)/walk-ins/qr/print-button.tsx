"use client";

import { Button } from "@/components/ui/button";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button className="h-12 px-8 print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
