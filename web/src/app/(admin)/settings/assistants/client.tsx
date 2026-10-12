"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users, ExternalLink } from "lucide-react";
import {
  createTaskType,
  updateTaskType,
  deleteTaskType,
  listTaskTypes,
  seedDefaultTaskTypes,
} from "@/actions/task-catalog";
import Link from "next/link";
import { useT } from "@/lib/terms/client";

interface TaskType {
  id: string;
  name: string;
  defaultDurationMinutes: number;
}

interface Assistant {
  id: string;
  displayName: string;
  email: string | null;
}

interface AssistantsPageClientProps {
  initialTaskTypes: TaskType[];
  assistants: Assistant[];
}

export function AssistantsPageClient({
  initialTaskTypes,
  assistants,
}: AssistantsPageClientProps) {
  const t = useT("settings");
  const router = useRouter();
  const [taskTypes, setTaskTypes] = useState<TaskType[]>(initialTaskTypes);
  const [isPending, startTransition] = useTransition();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<TaskType | null>(null);
  const [formName, setFormName] = useState("");
  const [formDuration, setFormDuration] = useState(30);

  function openCreateDialog() {
    setEditingType(null);
    setFormName("");
    setFormDuration(30);
    setDialogOpen(true);
  }

  function openEditDialog(taskType: TaskType) {
    setEditingType(taskType);
    setFormName(taskType.name);
    setFormDuration(taskType.defaultDurationMinutes);
    setDialogOpen(true);
  }

  async function handleSave() {
    startTransition(async () => {
      if (editingType) {
        const result = await updateTaskType(editingType.id, {
          name: formName,
          defaultDurationMinutes: formDuration,
        });
        if (result.success) {
          toast.success("Task type updated");
          setTaskTypes((prev) =>
            prev.map((t) =>
              t.id === editingType.id
                ? { ...t, name: formName, defaultDurationMinutes: formDuration }
                : t,
            ),
          );
        } else {
          toast.error(result.error);
        }
      } else {
        const result = await createTaskType({
          name: formName,
          defaultDurationMinutes: formDuration,
        });
        if (result.success) {
          toast.success("Task type created");
          setTaskTypes((prev) => [
            ...prev,
            {
              id: result.id,
              name: formName,
              defaultDurationMinutes: formDuration,
            },
          ]);
        } else {
          toast.error(result.error);
        }
      }
      setDialogOpen(false);
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this task type?")) return;

    startTransition(async () => {
      const result = await deleteTaskType(id);
      if (result.success) {
        toast.success("Task type removed");
        setTaskTypes((prev) => prev.filter((t) => t.id !== id));
      } else {
        toast.error(result.error);
      }
      router.refresh();
    });
  }

  async function handleSeedDefaults() {
    startTransition(async () => {
      const result = await seedDefaultTaskTypes();
      if (result.success) {
        const updatedTaskTypes = await listTaskTypes();
        setTaskTypes(updatedTaskTypes);
        toast.success(
          result.created > 0
            ? `Seeded ${result.created} default task types`
            : "Default task types are already seeded",
        );
      } else {
        toast.error(result.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {/* Section A: Task Catalog */}
      <Card>
        <CardHeader>
          <CardTitle>Task Catalog</CardTitle>
          <CardDescription>
            Define reusable task types that can be assigned to assistants when
            managing appointments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={openCreateDialog} >
            <Plus className="mr-1.5 size-4" />
            Add Task Type
          </Button>

          {taskTypes.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                {t("assistants.emptyHint")}
              </p>
              <Button
                type="button"
                variant="outline"
                
                onClick={handleSeedDefaults}
                disabled={isPending}
              >
                Seed default tasks
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {taskTypes.map((type) => (
                <div
                  key={type.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{type.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Default: {type.defaultDurationMinutes} min
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(type)}
                      disabled={isPending}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(type.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B: Assistant Roster */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Assistant Roster
          </CardTitle>
          <CardDescription>
            {t("assistantsPage.rosterCount", { count: assistants.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {assistants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No assistants have been added yet. Invite assistants from the Team
              settings page.
            </p>
          ) : (
            <div className="space-y-2">
              {assistants.map((assistant) => (
                <div
                  key={assistant.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {assistant.displayName}
                    </div>
                    {assistant.email && (
                      <div className="text-xs text-muted-foreground">
                        {assistant.email}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button asChild variant="outline" >
            <Link href="/settings/team">
              <ExternalLink className="mr-1.5 size-4" />
              Invite Assistants via Team Settings
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Task Type Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingType ? "Edit Task Type" : "Add Task Type"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Mix Color, Blow Dry, Shampoo"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Duration (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={formDuration}
                onChange={(e) => setFormDuration(Number(e.target.value))}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isPending || !formName || formDuration < 5}
              >
                {editingType ? "Save Changes" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
