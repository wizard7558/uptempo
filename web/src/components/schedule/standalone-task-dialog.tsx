"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { assignTask } from "@/actions/assistant-tasks";
import { format, addMinutes, startOfDay, setHours, setMinutes } from "date-fns";

interface TaskType {
  id: string;
  name: string;
  defaultDurationMinutes: number;
}

interface StandaloneTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistant: { id: string; displayName: string };
  taskTypes: TaskType[];
  /** The day the user is currently viewing on the schedule. */
  scheduleDate: Date;
  /** Optional slot selected from the assistant schedule column. */
  initialStartTime?: Date | null;
  onSaved: () => void;
}

const NO_TYPE_VALUE = "__none__";

/** Round `now` up to the next 15-minute slot, anchored within `scheduleDate`. */
function nextSlotOnDate(scheduleDate: Date): { hh: number; mm: number } {
  const now = new Date();
  const sameDay = now.toDateString() === scheduleDate.toDateString();
  // For future days, default to the typical morning prep window (09:00).
  // For today, default to the next 15-min slot.
  if (!sameDay) {
    return { hh: 9, mm: 0 };
  }
  const minutes = Math.ceil(now.getMinutes() / 15) * 15;
  let hh = now.getHours();
  let mm = minutes;
  if (mm === 60) {
    hh += 1;
    mm = 0;
  }
  return { hh, mm };
}

function formatTimeInput(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function getDefaultStartTime(
  scheduleDate: Date,
  initialStartTime?: Date | null,
): string {
  if (initialStartTime) return formatTimeInput(initialStartTime);
  const slot = nextSlotOnDate(scheduleDate);
  return `${slot.hh.toString().padStart(2, "0")}:${slot.mm
    .toString()
    .padStart(2, "0")}`;
}

export function StandaloneTaskDialog({
  open,
  onOpenChange,
  assistant,
  taskTypes,
  scheduleDate,
  initialStartTime,
  onSaved,
}: StandaloneTaskDialogProps) {
  const [selectedTaskTypeId, setSelectedTaskTypeId] =
    useState<string>(NO_TYPE_VALUE);
  const [taskName, setTaskName] = useState("");
  const [startTime, setStartTime] = useState(() =>
    getDefaultStartTime(scheduleDate, initialStartTime),
  );
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selectedTaskType = useMemo(
    () => taskTypes.find((t) => t.id === selectedTaskTypeId),
    [selectedTaskTypeId, taskTypes],
  );

  // Reset form when dialog opens.
  useEffect(() => {
    if (!open) return;
    setSelectedTaskTypeId(NO_TYPE_VALUE);
    setTaskName("");
    setStartTime(getDefaultStartTime(scheduleDate, initialStartTime));
    setDurationMinutes(30);
    setNotes("");
    setError(null);
  }, [open, scheduleDate, initialStartTime]);

  function handleTaskTypeChange(value: string) {
    setSelectedTaskTypeId(value);
    if (value === NO_TYPE_VALUE) {
      setTaskName("");
      setDurationMinutes(30);
      return;
    }
    const type = taskTypes.find((t) => t.id === value);
    if (type) {
      setTaskName(type.name);
      setDurationMinutes(type.defaultDurationMinutes);
    }
  }

  function handleSubmit() {
    setError(null);

    if (!taskName.trim()) {
      setError("Task name is required");
      return;
    }
    if (durationMinutes < 5 || durationMinutes > 480) {
      setError("Duration must be between 5 and 480 minutes");
      return;
    }

    const [hStr, mStr] = startTime.split(":");
    const hh = Number(hStr);
    const mm = Number(mStr);
    if (
      !Number.isFinite(hh) ||
      !Number.isFinite(mm) ||
      hh < 0 ||
      hh > 23 ||
      mm < 0 ||
      mm > 59
    ) {
      setError("Invalid start time");
      return;
    }

    const start = setMinutes(setHours(startOfDay(scheduleDate), hh), mm);
    const end = addMinutes(start, durationMinutes);

    startTransition(async () => {
      const result = await assignTask({
        appointmentId: null,
        assignedTo: assistant.id,
        taskTypeId:
          selectedTaskTypeId === NO_TYPE_VALUE ? undefined : selectedTaskTypeId,
        taskName: taskName.trim(),
        startTime: start,
        endTime: end,
        notes: notes.trim() === "" ? undefined : notes.trim(),
      });
      if (result.success) {
        toast.success(`Task added to ${assistant.displayName}'s schedule`);
        onSaved();
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add task to {assistant.displayName}</DialogTitle>
          <DialogDescription>
            {format(scheduleDate, "EEEE, MMM d")} — standalone task, not tied to
            a specific client booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="task-type">Task type</Label>
            <Select
              value={selectedTaskTypeId}
              onValueChange={handleTaskTypeChange}
            >
              <SelectTrigger id="task-type">
                <SelectValue placeholder="Choose task type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE_VALUE}>Custom task</SelectItem>
                {taskTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.defaultDurationMinutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTaskType && (
              <p className="text-xs text-muted-foreground">
                Using {selectedTaskType.name} defaults. You can still adjust the
                details below.
              </p>
            )}
            {taskTypes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Define reusable task types under Settings → Assistants.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-name">Task name</Label>
            <Input
              id="task-name"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="Color mixing, morning prep, …"
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-start">Start time</Label>
              <Input
                id="task-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                step={900}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-duration">Duration (min)</Label>
              <Input
                id="task-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={durationMinutes}
                onChange={(e) =>
                  setDurationMinutes(parseInt(e.target.value, 10) || 0)
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="task-notes">Notes (optional)</Label>
            <Textarea
              id="task-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything she should know"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
