"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import { Plus, Pencil, Trash2, HeartPulse, Eye } from "lucide-react";
import {
  createAftercareTemplate,
  updateAftercareTemplate,
  deactivateAftercareTemplate,
} from "@/actions/aftercare";
import { renderAftercarePreview } from "@/actions/email-preview";
import { EmailPreviewDialog } from "@/components/settings/email-preview-dialog";

interface AftercareTemplate {
  id: string;
  name: string;
  content: string;
  productRecommendations: string | null;
  isActive: number;
  serviceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface AftercarePageClientProps {
  initialTemplates: AftercareTemplate[];
  availableServices: Array<{ id: string; name: string }>;
}

function AftercareTemplateForm({
  template,
  availableServices,
  onSuccess,
}: {
  template?: AftercareTemplate;
  availableServices: Array<{ id: string; name: string }>;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [content, setContent] = useState(template?.content ?? "");
  const [productRecommendations, setProductRecommendations] = useState(
    template?.productRecommendations ?? "",
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    new Set(template?.serviceIds ?? []),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!template;

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
    setIsSubmitting(true);

    try {
      const payload = {
        name,
        content,
        productRecommendations: productRecommendations || undefined,
        serviceIds: Array.from(selectedServiceIds),
      };

      if (isEditing) {
        const result = await updateAftercareTemplate({
          ...payload,
          id: template.id,
        });
        if (!result.success) {
          toast.error("error" in result ? result.error : "Failed to update");
          return;
        }
        toast.success("Aftercare template updated");
      } else {
        const result = await createAftercareTemplate(payload);
        if (!result.success) {
          toast.error("error" in result ? result.error : "Failed to create");
          return;
        }
        toast.success("Aftercare template created");
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
        <Label htmlFor="aftercare-name">Template Name</Label>
        <Input
          id="aftercare-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Color Treatment Aftercare"
          required
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="aftercare-content">Instructions</Label>
        <Textarea
          id="aftercare-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write aftercare instructions for the client..."
          required
          maxLength={5000}
          rows={6}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="aftercare-products">
          Product Recommendations (optional)
        </Label>
        <Textarea
          id="aftercare-products"
          value={productRecommendations}
          onChange={(e) => setProductRecommendations(e.target.value)}
          placeholder="Recommend products for maintaining results..."
          maxLength={2000}
          rows={3}
        />
      </div>

      {availableServices.length > 0 && (
        <div className="space-y-3">
          <Label>Assign to Services</Label>
          <p className="text-xs text-muted-foreground">
            Clients completing these services will receive this aftercare.
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

export function AftercarePageClient({
  initialTemplates,
  availableServices,
}: AftercarePageClientProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<AftercareTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] =
    useState<AftercareTemplate | null>(null);
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

    const result = await deactivateAftercareTemplate(id);
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
            New Aftercare Template
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Aftercare Template</DialogTitle>
          </DialogHeader>
          <AftercareTemplateForm
            availableServices={availableServices}
            onSuccess={handleSuccess}
          />
        </DialogContent>
      </Dialog>

      {initialTemplates.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
          <HeartPulse className="mx-auto mb-3 size-10 opacity-40" />
          <p>
            No aftercare templates yet. Create your first template to get
            started.
          </p>
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
                  <CardDescription className="mt-1 line-clamp-2">
                    {template.content}
                  </CardDescription>
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
                <div className="space-y-2">
                  {template.productRecommendations && (
                    <p className="text-xs text-muted-foreground">
                      Has product recommendations
                    </p>
                  )}
                  {template.isActive === 0 && (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
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
                </div>
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
            <DialogTitle>Edit Aftercare Template</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <AftercareTemplateForm
              template={editingTemplate}
              availableServices={availableServices}
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
            const { html } = await renderAftercarePreview({
              templates: [
                {
                  name: previewTemplate.name,
                  content: previewTemplate.content,
                  productRecommendations:
                    previewTemplate.productRecommendations,
                },
              ],
            });
            return html;
          }}
        />
      )}
    </>
  );
}
