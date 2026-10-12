"use client";

import { useEffect, useState, useTransition } from "react";
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
import { Loader2, Trash2 } from "lucide-react";
import {
  deleteTask,
  getTaskById,
  updateTask,
} from "@/actions/assistant-tasks";

type TaskStatus = "pending" | "in-progress" | "completed" | "cancelled";

const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "in-progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

interface TaskDetailDialogProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface LoadedTask {
  id: string;
  assignedToName: string;
  taskName: string;
  during: { start: Date; end: Date };
  status: TaskStatus;
  notes: string;
}

function formatTimeInput(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function diffMinutes(start: Date, end: Date): number {
  return Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function TaskDetailDialog({
  taskId,
  open,
  onOpenChange,
  onSaved,
}: TaskDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<LoadedTask | null>(null);
  const [taskName, setTaskName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !taskId) {
      setTask(null);
      setError(null);
      setConfirmDelete(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getTaskById(taskId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("Task not found");
          setTask(null);
          return;
        }
        const start = new Date(row.during.start);
        const end = new Date(row.during.end);
        const loaded: LoadedTask = {
          id: row.id,
          assignedToName: row.assignedToName,
          taskName: row.taskName,
          during: { start, end },
          status: row.status as TaskStatus,
          notes: row.notes ?? "",
        };
        setTask(loaded);
        setTaskName(loaded.taskName);
        setStartTime(formatTimeInput(start));
        setDurationMinutes(diffMinutes(start, end));
        setStatus(loaded.status);
        setNotes(loaded.notes);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load task");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, taskId]);

  function handleSave() {
    if (!task) return;
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

    const newStart = new Date(task.during.start);
    newStart.setHours(hh, mm, 0, 0);
    const newEnd = new Date(newStart.getTime() + durationMinutes * 60_000);

    startTransition(async () => {
      const result = await updateTask({
        id: task.id,
        taskName: taskName.trim(),
        startTime: newStart,
        endTime: newEnd,
        status,
        notes: notes.trim(),
      });
      if (result.success) {
        toast.success("Task updated");
        onSaved();
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if (result.success) {
        toast.success("Task removed");
        onSaved();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            {task
              ? `Assigned to ${task.assignedToName}`
              : loading
                ? "Loading…"
                : " "}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {!loading && task && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="detail-task-name">Task name</Label>
              <Input
                id="detail-task-name"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="detail-start">Start time</Label>
                <Input
                  id="detail-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step={900}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="detail-duration">Duration (min)</Label>
                <Input
                  id="detail-duration"
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
              <Label htmlFor="detail-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as TaskStatus)}
              >
                <SelectTrigger id="detail-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="detail-notes">Notes</Label>
              <Textarea
                id="detail-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything she should know"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {!loading && !task && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDelete}
            disabled={!task || isPending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 size-4" />
            {confirmDelete ? "Click again to confirm" : "Delete"}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!task || isPending}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
