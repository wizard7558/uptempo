"use client";

import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ServiceNotes } from "./service-notes";
import { Clock, User, DollarSign } from "lucide-react";
import type { ServiceHistoryEntry } from "@/lib/queries/client-history";

interface ServiceHistoryProps {
  history: ServiceHistoryEntry[];
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

export function ServiceHistory({ history }: ServiceHistoryProps) {
  if (history.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No service history yet
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Appointment History</h3>
      <div className="space-y-3">
        {history.map((entry) => (
          <Card key={entry.appointmentId}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {format(entry.startTime, "MMM d, yyyy")}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {format(entry.startTime, "h:mm a")} -{" "}
                  {format(entry.endTime, "h:mm a")}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  {entry.staffName}
                </span>
                <Badge variant={statusBadgeVariant(entry.status)}>
                  {entry.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {entry.services.map((service) => (
                <div key={service.appointmentServiceId}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{service.serviceName}</span>
                    <span className="text-muted-foreground">
                      {service.durationMinutes} min
                    </span>
                    {service.isOverride === 1 && (
                      <Badge variant="outline" className="text-xs">
                        Custom duration
                      </Badge>
                    )}
                  </div>
                  <ServiceNotes
                    appointmentServiceId={service.appointmentServiceId}
                    serviceName={service.serviceName}
                    initialNotes={service.notes}
                  />
                </div>
              ))}

              {entry.charge && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      ${(entry.charge.amountCents / 100).toFixed(2)}
                    </span>
                    <Badge variant={statusBadgeVariant(entry.charge.status)}>
                      {entry.charge.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {entry.charge.reason}
                    </span>
                  </div>
                </>
              )}

              {entry.appointmentNotes && (
                <>
                  <Separator />
                  <p className="text-sm text-muted-foreground">
                    {entry.appointmentNotes}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
