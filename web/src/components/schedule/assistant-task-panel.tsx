"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
  assignTask,
  deleteTask,
  listTasksForAppointment,
} from "@/actions/assistant-tasks";

interface AssistantTaskPanelProps {
  open: boolean;
  appointmentId: string;
  appointmentStart: Date;
  appointmentEnd: Date;
  assistants: Array<{ id: string; displayName: string }>;
  taskTypes: Array<{
    id: string;
    name: string;
    defaultDurationMinutes: number;
  }>;
  onClose: () => void;
  onTasksChanged?: () => void;
}

interface TaskItem {
  id: string;
  taskName: string;
  during: { start: Date; end: Date };
  status: string;
  notes: string | null;
  assignedTo: string;
  assignedToName: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200",
  "in-progress":
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};
const NO_TYPE_VALUE = "__none__";

export function AssistantTaskPanel({
  open,
  appointmentId,
  appointmentStart,
  assistants,
  taskTypes,
  onClose,
  onTasksChanged,
}: AssistantTaskPanelProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedTaskTypeId, setSelectedTaskTypeId] =
    useState<string>(NO_TYPE_VALUE);
  const [taskName, setTaskName] = useState("");
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [notes, setNotes] = useState("");

  const loadTasks = useCallback(async () => {
    try {
      const result = await listTasksForAppointment(appointmentId);
      setTasks(
        result.map((t) => ({
          ...t,
          during: {
            start: new Date(t.during.start),
            end: new Date(t.during.end),
          },
        })),
      );
    } catch {
      setTasks([]);
    }
  }, [appointmentId]);

  // Load existing tasks on open
  useEffect(() => {
    if (open && appointmentId) {
      loadTasks();
    }
  }, [open, appointmentId, loadTasks]);

  // Initialize start time from appointment
  useEffect(() => {
    if (open) {
      const timeStr = appointmentStart.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      setStartTime(timeStr);
    }
  }, [open, appointmentStart]);

  function handleTaskTypeChange(typeId: string) {
    setSelectedTaskTypeId(typeId);
    if (typeId === NO_TYPE_VALUE) {
      setTaskName("");
      setDurationMinutes(30);
      return;
    }
    const taskType = taskTypes.find((t) => t.id === typeId);
    if (taskType) {
      setTaskName(taskType.name);
      setDurationMinutes(taskType.defaultDurationMinutes);
    }
  }

  async function handleAssignTask() {
    if (!taskName || !selectedAssistantId || !startTime) {
      setError("Please fill in all required fields");
      return;
    }

    setError(null);

    // Build start/end Date from the time input
    const [hours, minutes] = startTime.split(":").map(Number);
    const start = new Date(appointmentStart);
    start.setHours(hours, minutes, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    startTransition(async () => {
      const result = await assignTask({
        appointmentId,
        assignedTo: selectedAssistantId,
        taskTypeId:
          selectedTaskTypeId === NO_TYPE_VALUE
            ? undefined
            : selectedTaskTypeId,
        taskName,
        startTime: start,
        endTime: end,
        notes: notes || undefined,
      });

      if (result.success) {
        toast.success("Task assigned");
        // Reset form
        setTaskName("");
        setSelectedTaskTypeId(NO_TYPE_VALUE);
        setSelectedAssistantId("");
        setNotes("");
        loadTasks();
        onTasksChanged?.();
      } else {
        setError(result.error);
      }
    });
  }

  async function handleDeleteTask(taskId: string) {
    startTransition(async () => {
      const result = await deleteTask(taskId);
      if (result.success) {
        toast.success("Task removed");
        loadTasks();
        onTasksChanged?.();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assistant Tasks</DialogTitle>
        </DialogHeader>

        {/* Existing tasks */}
        <div className="space-y-2">
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No tasks assigned to this appointment yet.
            </p>
          )}
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start justify-between rounded-lg border p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{task.taskName}</span>
                  <Badge
                    variant="secondary"
                    className={STATUS_COLORS[task.status] ?? ""}
                  >
                    {task.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {task.assignedToName} &middot;{" "}
                  {task.during.start.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  -{" "}
                  {task.during.end.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
                {task.notes && (
                  <div className="text-xs text-muted-foreground">
                    {task.notes}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDeleteTask(task.id)}
                disabled={isPending}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        {/* Add task form */}
        <div className="space-y-3 border-t pt-3">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <Plus className="size-4" />
            Add Task
          </h4>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Task Type</Label>
            <Select
              value={selectedTaskTypeId}
              onValueChange={handleTaskTypeChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose task type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE_VALUE}>Custom task</SelectItem>
                {taskTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name} ({type.defaultDurationMinutes} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Task Name *</Label>
            <Input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="e.g., Mix color, Blow dry"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Assign To *</Label>
            <Select
              value={selectedAssistantId}
              onValueChange={setSelectedAssistantId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an assistant..." />
              </SelectTrigger>
              <SelectContent>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start Time *</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duration (min)</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="min-h-[60px] text-sm"
            />
          </div>

          <Button
            onClick={handleAssignTask}
            disabled={isPending || !taskName || !selectedAssistantId}
            className="w-full"
            
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Assigning...
              </>
            ) : (
              "Assign Task"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
