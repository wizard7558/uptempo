"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setDurationOverride,
  removeDurationOverride,
} from "@/actions/overrides";
import { listServices } from "@/actions/services";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Clock, DollarSign, Pencil } from "lucide-react";
import { formatCurrency } from "@/components/ui/chart-utils";

interface OverrideManagerProps {
  clientId: string;
  overrides: {
    serviceId: string;
    serviceName: string;
    defaultDurationMinutes: number;
    defaultPriceCents: number | null;
    overrideDurationMinutes: number | null;
    overridePriceCents: number | null;
  }[];
}

interface ServiceOption {
  id: string;
  name: string;
  defaultDurationMinutes: number;
  defaultPriceCents: number | null;
}

export function OverrideManager({ clientId, overrides }: OverrideManagerProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [price, setPrice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [removingServiceId, setRemovingServiceId] = useState<string | null>(null);
  const [availableServices, setAvailableServices] = useState<ServiceOption[]>(
    [],
  );

  useEffect(() => {
    async function loadServices() {
      const services = await listServices();
      setAvailableServices(
        services
          .map((s) => ({
            id: s.id,
            name: s.name,
            defaultDurationMinutes: s.defaultDurationMinutes,
            defaultPriceCents: s.priceCents,
          })),
      );
    }
    loadServices();
  }, [overrides]);

  function resetForm() {
    setIsEditing(false);
    setSelectedServiceId("");
    setDurationMinutes("");
    setPrice("");
  }

  function parsePriceToCents(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return Math.round(parsed * 100);
  }

  function handleAddClick() {
    resetForm();
    setIsEditing(true);
  }

  function handleEdit(serviceId: string) {
    const override = overrides.find((item) => item.serviceId === serviceId);
    if (!override) return;
    setSelectedServiceId(serviceId);
    setDurationMinutes(
      override.overrideDurationMinutes != null
        ? String(override.overrideDurationMinutes)
        : "",
    );
    setPrice(
      override.overridePriceCents != null
        ? (override.overridePriceCents / 100).toFixed(2)
        : "",
    );
    setIsEditing(true);
  }

  function handleSave() {
    if (!selectedServiceId) {
      toast.error("Select a service first");
      return;
    }

    const durationValue = durationMinutes.trim();
    const parsedDuration = durationValue ? Number.parseInt(durationValue, 10) : undefined;
    const parsedPrice = parsePriceToCents(price);

    if (
      durationValue &&
      (!Number.isFinite(parsedDuration) || parsedDuration == null || parsedDuration < 5)
    ) {
      toast.error("Custom duration must be at least 5 minutes");
      return;
    }
    if (
      parsedPrice !== undefined &&
      (!Number.isFinite(parsedPrice) || parsedPrice < 0)
    ) {
      toast.error("Custom price must be a valid dollar amount");
      return;
    }
    if (parsedDuration == null && parsedPrice == null) {
      toast.error("Add a custom duration or price");
      return;
    }

    startTransition(async () => {
      const result = await setDurationOverride({
        clientId,
        serviceId: selectedServiceId,
        durationMinutes: parsedDuration,
        priceCents: parsedPrice,
      });

      if (result.success) {
        toast.success("Client override saved");
        resetForm();
        router.refresh();
      } else {
        const error = "error" in result ? result.error : null;
        const message =
          error && typeof error === "object" && "message" in error
            ? (error as { message: string }).message
            : "Failed to save override";
        toast.error(message);
      }
    });
  }

  async function handleRemove(serviceId: string) {
    setRemovingServiceId(serviceId);
    const result = await removeDurationOverride({ clientId, serviceId });
    setRemovingServiceId(null);

    if (result.success) {
      toast.success("Client override removed");
      router.refresh();
    } else {
      const error = "error" in result ? result.error : null;
      const message =
        error && typeof error === "object" && "message" in error
          ? (error as { message: string }).message
          : "Failed to remove override";
      toast.error(message);
    }
  }

  function handleCancelAdd() {
    resetForm();
  }

  function handleServiceChange(serviceId: string) {
    setSelectedServiceId(serviceId);
    const service = availableServices.find((s) => s.id === serviceId);
    const existingOverride = overrides.find((item) => item.serviceId === serviceId);
    if (existingOverride) {
      setDurationMinutes(
        existingOverride.overrideDurationMinutes != null
          ? String(existingOverride.overrideDurationMinutes)
          : "",
      );
      setPrice(
        existingOverride.overridePriceCents != null
          ? (existingOverride.overridePriceCents / 100).toFixed(2)
          : "",
      );
      return;
    }
    if (service) {
      setDurationMinutes(String(service.defaultDurationMinutes));
      setPrice("");
    }
  }

  const selectableServices = isEditing && selectedServiceId
    ? availableServices
    : availableServices.filter(
        (service) => !overrides.some((override) => override.serviceId === service.id),
      );
  const canAddOverride = availableServices.some(
    (service) => !overrides.some((override) => override.serviceId === service.id),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Service Overrides</CardTitle>
          <CardDescription>
            Custom appointment duration and pricing for this client&apos;s services.
          </CardDescription>
        </div>
        {!isEditing && (
          <Button  onClick={handleAddClick} disabled={!canAddOverride}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add override
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {overrides.length === 0 && !isEditing && (
          <p className="text-sm text-muted-foreground">
            No custom pricing or duration set. Default service values will be used.
          </p>
        )}
        {!canAddOverride && !isEditing && (
          <p className="text-sm text-muted-foreground">
            Every active service already has an override. Edit an existing override to make changes.
          </p>
        )}

        {overrides.map((override) => (
          <div
            key={override.serviceId}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <p className="font-medium">{override.serviceName}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Default {override.defaultDurationMinutes} min
                </span>
                <Badge variant="secondary">
                  {override.overrideDurationMinutes != null
                    ? `${override.overrideDurationMinutes} min`
                    : "Default duration"}
                </Badge>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  Default{" "}
                  {override.defaultPriceCents != null
                    ? formatCurrency(override.defaultPriceCents)
                    : "No price"}
                </span>
                <Badge variant="secondary">
                  {override.overridePriceCents != null
                    ? formatCurrency(override.overridePriceCents)
                    : "Default price"}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                variant="outline"
                
                onClick={() => handleEdit(override.serviceId)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                variant="ghost"
                
                onClick={() => handleRemove(override.serviceId)}
                disabled={removingServiceId === override.serviceId}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        {isEditing && (
          <div className="rounded-lg border p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Service</label>
              <Select
                value={selectedServiceId}
                onValueChange={handleServiceChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {selectableServices.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name} - {service.defaultDurationMinutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Custom Duration (minutes)
                </label>
                <Input
                  type="number"
                  min={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="Leave blank to keep default"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Custom Price
                </label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Leave blank to keep default"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={isPending || !selectedServiceId}
              >
                {isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={handleCancelAdd} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
