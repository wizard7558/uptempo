"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DurationBadgeProps {
  durationMinutes: number;
  isOverride: boolean;
}

export function DurationBadge({
  durationMinutes,
  isOverride,
}: DurationBadgeProps) {
  const label = `${durationMinutes} min`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isOverride ? "default" : "secondary"}
            className="text-xs"
          >
            {label}
            {isOverride && " *"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {isOverride
            ? "Custom duration for this client"
            : "Standard service duration"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
