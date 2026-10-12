"use client";

import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarClock } from "lucide-react";
import type { ServiceFrequency } from "@/actions/clients";

interface FrequencyTrackerProps {
  frequency: ServiceFrequency[];
}

function statusBadge(status: ServiceFrequency["status"]) {
  switch (status) {
    case "overdue":
      return <Badge variant="destructive">Overdue</Badge>;
    case "due_soon":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          Due soon
        </Badge>
      );
    case "on_track":
      return <Badge variant="secondary">On track</Badge>;
  }
}

export function FrequencyTracker({ frequency }: FrequencyTrackerProps) {
  if (frequency.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Not enough visit history to calculate frequency. At least 2
          appointments of the same service are needed.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <CalendarClock className="h-5 w-5" />
        Service Frequency
      </h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {frequency.map((item) => (
          <Card key={item.serviceId}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{item.serviceName}</CardTitle>
                {statusBadge(item.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>Last visit: {format(item.lastPerformed, "MMM d, yyyy")}</p>
              <p>Every ~{item.averageIntervalDays} days</p>
              <p>Next due: {format(item.nextDueDate, "MMM d, yyyy")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
