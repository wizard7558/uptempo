"use client";

import { useEffect, useState } from "react";
import { getServiceFrequency, type ServiceFrequency } from "@/actions/clients";
import { differenceInDays } from "date-fns";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface RebookPromptProps {
  clientId: string;
  businessSlug?: string;
}

export function RebookPrompt({ clientId, businessSlug }: RebookPromptProps) {
  const [frequencies, setFrequencies] = useState<ServiceFrequency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServiceFrequency(clientId)
      .then(setFrequencies)
      .catch(() => setFrequencies([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) return null;

  const dueServices = frequencies.filter(
    (f) => f.status === "due_soon" || f.status === "overdue",
  );

  const bookUrl = businessSlug ? `/book/${businessSlug}` : "/book";

  if (dueServices.length > 0) {
    return (
      <div className="rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <h4 className="font-semibold text-amber-900 dark:text-amber-200">
            Time to rebook!
          </h4>
        </div>
        <ul className="space-y-1.5">
          {dueServices.map((svc) => {
            const now = new Date();
            const days = differenceInDays(svc.nextDueDate, now);
            const dueText =
              days < 0
                ? `overdue by ${Math.abs(days)} days`
                : days === 0
                  ? "due today"
                  : `due in ${days} days`;

            return (
              <li
                key={svc.serviceId}
                className="text-sm text-amber-800 dark:text-amber-300"
              >
                <span className="font-medium">{svc.serviceName}</span>
                {" -- "}
                <span>{dueText}</span>
              </li>
            );
          })}
        </ul>
        <Button asChild className="w-full bg-amber-600 hover:bg-amber-700 text-white">
          <Link href={bookUrl}>Book Now</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-center">
      <p className="text-sm text-muted-foreground">
        Want to book your next appointment?
      </p>
      <Button asChild variant="outline" className="w-full">
        <Link href={bookUrl}>Book Again</Link>
      </Button>
    </div>
  );
}
