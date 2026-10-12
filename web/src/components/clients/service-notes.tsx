"use client";

import { useState } from "react";
import { updateServiceNote } from "@/actions/clients";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

interface ServiceNotesProps {
  appointmentServiceId: string;
  serviceName: string;
  initialNotes: string | null;
}

export function ServiceNotes({
  appointmentServiceId,
  initialNotes,
}: ServiceNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    const result = await updateServiceNote({
      appointmentServiceId,
      notes: notes.trim() || null,
    });
    setIsSaving(false);

    if (result.success) {
      toast.success("Notes updated");
      setIsEditing(false);
    } else {
      toast.error("Failed to update notes");
    }
  }

  function handleCancel() {
    setNotes(initialNotes ?? "");
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <div className="mt-1 space-y-2">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Color formulas, techniques, preferences..."
          className="text-sm"
        />
        <div className="flex gap-2">
          <Button  onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button  variant="outline" onClick={handleCancel} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (initialNotes) {
    return (
      <button
        onClick={() => setIsEditing(true)}
        className="mt-1 flex items-start gap-1 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="whitespace-pre-wrap">{initialNotes}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <Plus className="h-3 w-3" />
      Add notes
    </button>
  );
}
