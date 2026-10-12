"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTimeBlock } from "@/actions/time-blocks";
import { getStaffLocations } from "@/actions/locations";
import { toast } from "sonner";
import { format } from "date-fns";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

interface TimeBlockFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string | null;
  startTime: Date | null;
  onCreated: () => void;
}

export function TimeBlockFormDialog({
  open,
  onOpenChange,
  staffId,
  startTime,
  onCreated,
}: TimeBlockFormDialogProps) {
  const [duration, setDuration] = useState<number>(30);
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<
    { id: string; name: string }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !staffId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    getStaffLocations(staffId).then((rows) => {
      if (cancelled) return;
      setLocations(rows.map((r) => ({ id: r.id, name: r.name })));
      if (rows.length === 1) setLocationId(rows[0].id);
      else setLocationId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, staffId]);

  useEffect(() => {
    if (open) {
      setDuration(30);
      setLabel("");
    }
  }, [open]);

  async function handleSubmit() {
    if (!staffId || !startTime) return;
    setSubmitting(true);
    const result = await createTimeBlock({
      staffId,
      startTime: startTime.toISOString(),
      durationMinutes: duration,
      label: label.trim() || null,
      locationId: locationId ?? null,
    });
    setSubmitting(false);
    if (result.success) {
      toast.success("Time blocked");
      onOpenChange(false);
      onCreated();
    } else {
      toast.error(
        "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to create block",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block time</DialogTitle>
          <DialogDescription>
            {startTime
              ? format(startTime, "EEEE, MMM d 'at' h:mm a")
              : "Choose how long to block on the schedule."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select
              value={String(duration)}
              onValueChange={(v) => setDuration(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {locations.length > 0 && (
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={locationId ?? ""}
                onValueChange={(v) => setLocationId(v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tb-label">Label (optional)</Label>
            <Input
              id="tb-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Lunch, paperwork"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !staffId}>
            {submitting ? "Saving…" : "Block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
