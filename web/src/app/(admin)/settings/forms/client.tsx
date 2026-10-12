"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/terms/client";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ClipboardList,
  GripVertical,
  X,
  Eye,
} from "lucide-react";
import {
  createFormTemplate,
  updateFormTemplate,
  deactivateFormTemplate,
  updateIdRetention,
} from "@/actions/forms";
import { renderFormRequestPreview } from "@/actions/email-preview";
import { EmailPreviewDialog } from "@/components/settings/email-preview-dialog";
import { FORM_KINDS, type FormField, type FormKind } from "@/lib/validators/forms";

interface FormTemplate {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: number;
  kind: string;
  minAge: number | null;
  requiresId: number;
  serviceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface FormsPageClientProps {
  initialTemplates: FormTemplate[];
  availableServices: Array<{ id: string; name: string }>;
  /** business_settings.id_retention_days */
  idRetentionDays: number;
}

const RETENTION_OPTIONS = [30, 90, 180, 365, 730] as const;
const MIN_AGE_OPTIONS = [16, 18, 21] as const;

function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function FormTemplateForm({
  template,
  availableServices,
  idRetentionDays,
  onSuccess,
}: {
  template?: FormTemplate;
  availableServices: Array<{ id: string; name: string }>;
  idRetentionDays: number;
  onSuccess: () => void;
}) {
  const tc = useT("consent");
  const [kind, setKind] = useState<FormKind>(
    (FORM_KINDS as readonly string[]).includes(template?.kind ?? "")
      ? (template!.kind as FormKind)
      : "intake",
  );
  const [minAge, setMinAge] = useState<number | null>(template?.minAge ?? null);
  const [requiresId, setRequiresId] = useState(template?.requiresId === 1);
  const [retentionDays, setRetentionDays] = useState(idRetentionDays);
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(
    template?.description ?? "",
  );
  const [fields, setFields] = useState<FormField[]>(
    template?.fields ?? [],
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    new Set(template?.serviceIds ?? []),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!template;

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        id: generateFieldId(),
        type: "text" as const,
        label: "",
        required: false,
      },
    ]);
  }

  function updateField(index: number, updates: Partial<FormField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f)),
    );
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function changeRetention(value: string) {
    const days = Number(value);
    const previous = retentionDays;
    setRetentionDays(days);
    const result = await updateIdRetention(days);
    if (!result.success) {
      setRetentionDays(previous);
      toast.error(result.error);
    } else {
      toast.success(tc("retention"));
    }
  }

  function toggleService(serviceId: string) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (fields.length === 0) {
      toast.error("Add at least one field to the form");
      return;
    }

    for (const field of fields) {
      if (!field.label.trim()) {
        toast.error("All fields must have a label");
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const payload = {
        name,
        description: description || undefined,
        fields,
        serviceIds: Array.from(selectedServiceIds),
        kind,
        minAge: kind === "consent" ? minAge : null,
        requiresId: kind === "consent" && requiresId ? (1 as const) : (0 as const),
      };

      if (isEditing) {
        const result = await updateFormTemplate({ ...payload, id: template.id });
        if (!result.success) {
          toast.error("error" in result ? result.error : "Failed to update");
          return;
        }
        toast.success("Form template updated");
      } else {
        const result = await createFormTemplate(payload);
        if (!result.success) {
          toast.error("error" in result ? result.error : "Failed to create");
          return;
        }
        toast.success("Form template created");
      }

      onSuccess();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="form-name">Template Name</Label>
        <Input
          id="form-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. New Client Intake Form"
          required
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="form-description">Description (optional)</Label>
        <Textarea
          id="form-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description shown to clients"
          maxLength={1000}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="form-kind">{tc("formType")}</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as FormKind)}>
          <SelectTrigger id="form-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORM_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {tc(`types.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === "consent" && (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="form-min-age">{tc("minAge")}</Label>
            <Select
              value={minAge == null ? "none" : String(minAge)}
              onValueChange={(v) => setMinAge(v === "none" ? null : Number(v))}
            >
              <SelectTrigger id="form-min-age" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tc("none")}</SelectItem>
                {MIN_AGE_OPTIONS.map((age) => (
                  <SelectItem key={age} value={String(age)}>
                    {age}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="form-requires-id">{tc("askId")}</Label>
            <Switch id="form-requires-id" checked={requiresId} onCheckedChange={setRequiresId} />
          </div>
          {requiresId && (
            <div className="space-y-2">
              <Label htmlFor="form-id-retention">{tc("retention")}</Label>
              <Select value={String(retentionDays)} onValueChange={changeRetention}>
                <SelectTrigger id="form-id-retention" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {tc(`retentionOptions.d${d}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tc("retentionHint")}</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Form Fields</Label>
          <Button type="button" variant="outline"  onClick={addField}>
            <Plus className="size-3.5" />
            Add Field
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4 text-center">
            No fields yet. Add fields to build your form.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="flex items-start gap-2 rounded-lg border p-3"
              >
                <GripVertical className="mt-2.5 size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={field.label}
                      onChange={(e) =>
                        updateField(index, { label: e.target.value })
                      }
                      placeholder="Field label"
                      className="flex-1"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) =>
                        updateField(index, {
                          type: value as FormField["type"],
                        })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="signature">Signature</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={field.required}
                        onCheckedChange={(checked) =>
                          updateField(index, { required: !!checked })
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        Required
                      </span>
                    </label>
                    {field.type === "text" && (
                      <Input
                        value={field.placeholder ?? ""}
                        onChange={(e) =>
                          updateField(index, {
                            placeholder: e.target.value || undefined,
                          })
                        }
                        placeholder="Placeholder text (optional)"
                        className="flex-1 h-7 text-xs"
                      />
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeField(index)}
                  className="mt-1"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {availableServices.length > 0 && (
        <div className="space-y-3">
          <Label>Assign to Services</Label>
          <p className="text-xs text-muted-foreground">
            Clients booking these services will receive this form.
          </p>
          <div className="space-y-2">
            {availableServices.map((service) => (
              <label
                key={service.id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  checked={selectedServiceIds.has(service.id)}
                  onCheckedChange={() => toggleService(service.id)}
                />
                <span className="text-sm">{service.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting
          ? "Saving..."
          : isEditing
            ? "Update Template"
            : "Create Template"}
      </Button>
    </form>
  );
}

export function FormsPageClient({
  initialTemplates,
  availableServices,
  idRetentionDays,
}: FormsPageClientProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(
    null,
  );
  const [previewTemplate, setPreviewTemplate] = useState<FormTemplate | null>(
    null,
  );
  const [, startTransition] = useTransition();
  const router = useRouter();

  function handleSuccess() {
    setAddDialogOpen(false);
    setEditingTemplate(null);
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Are you sure you want to deactivate "${name}"?`)) return;

    const result = await deactivateFormTemplate(id);
    if (result.success) {
      toast.success(`"${name}" has been deactivated`);
      startTransition(() => {
        router.refresh();
      });
    } else {
      toast.error("Failed to deactivate template");
    }
  }

  const serviceMap = new Map(availableServices.map((s) => [s.id, s.name]));

  return (
    <>
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            New Form Template
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Form Template</DialogTitle>
          </DialogHeader>
          <FormTemplateForm
            availableServices={availableServices}
            idRetentionDays={idRetentionDays}
            onSuccess={handleSuccess}
          />
        </DialogContent>
      </Dialog>

      {initialTemplates.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
          <ClipboardList className="mx-auto mb-3 size-10 opacity-40" />
          <p>No form templates yet. Create your first template to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialTemplates.map((template) => (
            <Card
              key={template.id}
              className={template.isActive === 0 ? "opacity-50" : ""}
            >
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base truncate">
                    {template.name}
                  </CardTitle>
                  {template.description && (
                    <CardDescription className="mt-1 line-clamp-2">
                      {template.description}
                    </CardDescription>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPreviewTemplate(template)}
                    title="Preview email"
                  >
                    <Eye />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingTemplate(template)}
                    title="Edit"
                  >
                    <Pencil />
                  </Button>
                  {template.isActive === 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        handleDeactivate(template.id, template.name)
                      }
                      title="Deactivate"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  {template.fields.length} field
                  {template.fields.length !== 1 ? "s" : ""}
                  {template.isActive === 0 && (
                    <Badge variant="secondary" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </p>
                {template.serviceIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {template.serviceIds.map((sid) => (
                      <Badge key={sid} variant="secondary">
                        {serviceMap.get(sid) ?? "Unknown"}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not assigned to any services
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!editingTemplate}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Form Template</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <FormTemplateForm
              template={editingTemplate}
              availableServices={availableServices}
              idRetentionDays={idRetentionDays}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      {previewTemplate && (
        <EmailPreviewDialog
          open={!!previewTemplate}
          onOpenChange={(open) => !open && setPreviewTemplate(null)}
          title={`Preview: ${previewTemplate.name}`}
          loadHtml={async () => {
            const { html } = await renderFormRequestPreview({
              formName: previewTemplate.name,
              formDescription: previewTemplate.description,
            });
            return html;
          }}
        />
      )}
    </>
  );
}
