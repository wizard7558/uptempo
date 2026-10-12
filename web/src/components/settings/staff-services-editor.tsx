"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useT } from "@/lib/terms/client";
import { PlusIcon, RotateCcwIcon, ChevronDownIcon } from "lucide-react";
import {
  setStaffServiceOffering,
  removeStaffServiceOffering,
  createCustomServiceForStaffMember,
  type StaffServiceMatrixRow,
} from "@/actions/staff-services";
import {
  formatServiceCategory,
  SERVICE_CATEGORY_OPTIONS,
  type ServiceCategory,
} from "@/lib/services/categories";
import { formatCurrency } from "@/components/ui/chart-utils";
import { cn } from "@/lib/utils";

interface StaffServicesEditorProps {
  staffId: string;
  initialMatrix: StaffServiceMatrixRow[];
}

export function StaffServicesEditor({
  staffId,
  initialMatrix,
}: StaffServicesEditorProps) {
  const t = useT("settings");
  const [matrix, setMatrix] = useState(initialMatrix);
  const [filter, setFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return matrix;
    return matrix.filter(
      (r) =>
        r.serviceName.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.customName?.toLowerCase().includes(q),
    );
  }, [matrix, filter]);

  const offeredCount = matrix.filter((r) => r.isLinked && r.isOffered).length;

  function applyRowUpdate(serviceId: string, updates: Partial<StaffServiceMatrixRow>) {
    setMatrix((prev) =>
      prev.map((r) => (r.serviceId === serviceId ? { ...r, ...updates } : r)),
    );
  }

  function removeRow(serviceId: string) {
    setMatrix((prev) => prev.filter((r) => r.serviceId !== serviceId));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter services..."
            className="max-w-xs"
          />
          <span className="text-sm text-muted-foreground">
            {offeredCount} offered · {matrix.length} in catalog
          </span>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon className="size-4" />
              Add custom service
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Custom service</DialogTitle>
              <DialogDescription>
                {t("staffServices.customDescription")}
              </DialogDescription>
            </DialogHeader>
            <CustomServiceForm
              staffId={staffId}
              onSuccess={(row) => {
                setMatrix((prev) => [...prev, row].sort((a, b) =>
                  a.serviceName.localeCompare(b.serviceName),
                ));
                setShowAdd(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="divide-y rounded-lg border bg-card">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {matrix.length === 0
              ? t("staffServices.emptyCatalog")
              : "No services match that filter."}
          </div>
        ) : (
          filtered.map((row) => (
            <ServiceRow
              key={row.serviceId}
              row={row}
              staffId={staffId}
              onUpdate={(updates) => applyRowUpdate(row.serviceId, updates)}
              onRemove={() => removeRow(row.serviceId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ServiceRow({
  row,
  staffId,
  onUpdate,
  onRemove,
}: {
  row: StaffServiceMatrixRow;
  staffId: string;
  onUpdate: (updates: Partial<StaffServiceMatrixRow>) => void;
  onRemove: () => void;
}) {
  const t = useT("settings");
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const effectivePrice = row.overridePriceCents ?? row.defaultPriceCents;
  const effectiveDuration =
    row.overrideDurationMinutes ?? row.defaultDurationMinutes;
  const hasAnyOverride =
    row.overridePriceCents != null ||
    row.overrideDurationMinutes != null ||
    row.overrideActiveMinutes != null ||
    row.overrideProcessingMinutes != null ||
    row.customName != null;

  function handleToggleOffer(offered: boolean) {
    startTransition(async () => {
      const next: Partial<StaffServiceMatrixRow> = {
        isLinked: true,
        isOffered: offered,
      };
      const result = await setStaffServiceOffering({
        staffId,
        serviceId: row.serviceId,
        priceCents: row.overridePriceCents,
        durationMinutes: row.overrideDurationMinutes,
        activeMinutes: row.overrideActiveMinutes,
        processingMinutes: row.overrideProcessingMinutes,
        customName: row.customName,
        isOffered: offered,
      });
      if (result.success) {
        onUpdate(next);
        toast.success(offered ? "Now offered" : "Hidden from booking");
      } else {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? (result.error as { message: string }).message
            : "Failed to update",
        );
      }
    });
  }

  function handleUnlink() {
    if (
      !window.confirm(
        t(expanded ? "staffServices.unlinkConfirmExpanded" : "staffServices.unlinkConfirm", {
          name: row.serviceName,
        }),
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await removeStaffServiceOffering({
        staffId,
        serviceId: row.serviceId,
      });
      if (result.success) {
        onRemove();
        toast.success("Removed");
      } else {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? (result.error as { message: string }).message
            : "Failed to remove",
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <Switch
          checked={row.isLinked && row.isOffered}
          disabled={isPending}
          onCheckedChange={handleToggleOffer}
          aria-label={`Offer ${row.serviceName}`}
        />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 transition-transform text-muted-foreground",
              expanded && "rotate-180",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {row.customName ?? row.serviceName}
              {row.customName && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (catalog: {row.serviceName})
                </span>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-normal">
                {formatServiceCategory(row.category)}
              </Badge>
              <span>{effectiveDuration} min</span>
              <span>·</span>
              <span>
                {effectivePrice != null
                  ? formatCurrency(effectivePrice)
                  : "No price"}
              </span>
              {hasAnyOverride && (
                <Badge variant="secondary" className="font-normal">
                  Custom
                </Badge>
              )}
              {row.isLinked && !row.isOffered && (
                <Badge variant="outline" className="font-normal text-amber-700 dark:text-amber-400">
                  Hidden
                </Badge>
              )}
            </span>
          </span>
        </button>
      </div>

      {expanded && (
        <OverrideEditor
          row={row}
          staffId={staffId}
          onSaved={onUpdate}
          onUnlink={handleUnlink}
        />
      )}
    </div>
  );
}

function OverrideEditor({
  row,
  staffId,
  onSaved,
  onUnlink,
}: {
  row: StaffServiceMatrixRow;
  staffId: string;
  onSaved: (updates: Partial<StaffServiceMatrixRow>) => void;
  onUnlink: () => void;
}) {
  const t = useT("settings");
  const [customName, setCustomName] = useState(row.customName ?? "");
  const [priceStr, setPriceStr] = useState(
    row.overridePriceCents != null
      ? (row.overridePriceCents / 100).toFixed(2)
      : "",
  );
  const [durationStr, setDurationStr] = useState(
    row.overrideDurationMinutes != null
      ? row.overrideDurationMinutes.toString()
      : "",
  );
  const [activeStr, setActiveStr] = useState(
    row.overrideActiveMinutes != null
      ? row.overrideActiveMinutes.toString()
      : "",
  );
  const [processingStr, setProcessingStr] = useState(
    row.overrideProcessingMinutes != null
      ? row.overrideProcessingMinutes.toString()
      : "",
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCustomName("");
    setPriceStr("");
    setDurationStr("");
    setActiveStr("");
    setProcessingStr("");
    setError(null);
  }

  function save() {
    setError(null);

    const trimmedName = customName.trim();
    const priceCents =
      priceStr.trim() === ""
        ? null
        : Math.round(Number(priceStr) * 100);
    const durationMinutes =
      durationStr.trim() === "" ? null : parseInt(durationStr, 10);
    const activeMinutes =
      activeStr.trim() === "" ? null : parseInt(activeStr, 10);
    const processingMinutes =
      processingStr.trim() === "" ? null : parseInt(processingStr, 10);

    if (priceStr.trim() !== "") {
      if (!Number.isFinite(priceCents) || priceCents == null || priceCents < 0) {
        setError("Price must be a valid dollar amount");
        return;
      }
    }
    if (durationStr.trim() !== "") {
      if (
        !Number.isFinite(durationMinutes) ||
        durationMinutes == null ||
        durationMinutes < 5 ||
        durationMinutes > 480
      ) {
        setError("Duration must be between 5 and 480 minutes");
        return;
      }
    }
    if (activeMinutes != null && processingMinutes == null) {
      setError("Set both active and processing minutes, or neither");
      return;
    }
    if (processingMinutes != null && activeMinutes == null) {
      setError("Set both active and processing minutes, or neither");
      return;
    }
    if (activeMinutes != null && processingMinutes != null) {
      const total = durationMinutes ?? row.defaultDurationMinutes;
      if (activeMinutes + processingMinutes > total) {
        setError("Active + processing must not exceed total duration");
        return;
      }
    }

    startTransition(async () => {
      const result = await setStaffServiceOffering({
        staffId,
        serviceId: row.serviceId,
        priceCents,
        durationMinutes,
        activeMinutes,
        processingMinutes,
        customName: trimmedName === "" ? null : trimmedName,
        isOffered: row.isLinked ? row.isOffered : true,
      });
      if (result.success) {
        onSaved({
          isLinked: true,
          isOffered: row.isLinked ? row.isOffered : true,
          customName: trimmedName === "" ? null : trimmedName,
          overridePriceCents: priceCents,
          overrideDurationMinutes: durationMinutes,
          overrideActiveMinutes: activeMinutes,
          overrideProcessingMinutes: processingMinutes,
        });
        toast.success("Saved");
      } else {
        toast.error(
          "error" in result && result.error && "message" in result.error
            ? (result.error as { message: string }).message
            : "Failed to save",
        );
      }
    });
  }

  return (
    <div className="ml-12 space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Custom name</Label>
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={row.serviceName}
          />
          <p className="text-xs text-muted-foreground">
            {t("staffServices.customNameHint")}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Price override</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder={
              row.defaultPriceCents != null
                ? (row.defaultPriceCents / 100).toFixed(2)
                : "—"
            }
          />
          <p className="text-xs text-muted-foreground">
            Catalog default:{" "}
            {row.defaultPriceCents != null
              ? formatCurrency(row.defaultPriceCents)
              : "no price"}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duration override (min)</Label>
          <Input
            type="number"
            min={5}
            max={480}
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            placeholder={row.defaultDurationMinutes.toString()}
          />
          <p className="text-xs text-muted-foreground">
            Catalog default: {row.defaultDurationMinutes} min
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Active min override</Label>
            <Input
              type="number"
              min={1}
              max={480}
              value={activeStr}
              onChange={(e) => setActiveStr(e.target.value)}
              placeholder={
                row.defaultActiveMinutes?.toString() ?? "—"
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Processing min override</Label>
            <Input
              type="number"
              min={1}
              max={480}
              value={processingStr}
              onChange={(e) => setProcessingStr(e.target.value)}
              placeholder={
                row.defaultProcessingMinutes?.toString() ?? "—"
              }
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          
          onClick={reset}
          disabled={isPending}
        >
          <RotateCcwIcon className="size-3.5" />
          Clear overrides
        </Button>
        <div className="flex items-center gap-2">
          {row.isLinked && (
            <Button
              type="button"
              variant="ghost"
              
              onClick={onUnlink}
              disabled={isPending}
              className="text-muted-foreground hover:text-destructive"
            >
              Don&apos;t offer
            </Button>
          )}
          <Button type="button"  onClick={save} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CustomServiceForm({
  staffId,
  onSuccess,
}: {
  staffId: string;
  onSuccess: (row: StaffServiceMatrixRow) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("60");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<ServiceCategory>("other");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    const durNum = parseInt(duration, 10);
    if (!Number.isFinite(durNum) || durNum < 5 || durNum > 480) {
      setError("Duration must be between 5 and 480 minutes");
      return;
    }
    const priceCents =
      price.trim() === ""
        ? null
        : Math.round(Number(price) * 100);
    if (priceCents != null && (!Number.isFinite(priceCents) || priceCents < 0)) {
      setError("Price must be a valid dollar amount");
      return;
    }

    startTransition(async () => {
      const result = await createCustomServiceForStaffMember({
        staffId,
        name: trimmed,
        description: description.trim() === "" ? null : description.trim(),
        defaultDurationMinutes: durNum,
        priceCents,
        category,
      });
      if (result.success) {
        onSuccess({
          serviceId: result.id,
          serviceName: trimmed,
          category,
          description: description.trim() === "" ? null : description.trim(),
          defaultDurationMinutes: durNum,
          defaultPriceCents: priceCents,
          defaultActiveMinutes: null,
          defaultProcessingMinutes: null,
          isLinked: true,
          isOffered: true,
          customName: null,
          overridePriceCents: null,
          overrideDurationMinutes: null,
          overrideActiveMinutes: null,
          overrideProcessingMinutes: null,
        });
        toast.success("Custom service created");
      } else {
        const msg =
          result.error && "message" in result.error
            ? (result.error as { message: string }).message
            : "Failed to create service";
        setError(msg);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="cs-name">Service name</Label>
        <Input
          id="cs-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Riley's signature haircut"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cs-description">Description (optional)</Label>
        <Textarea
          id="cs-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shown as helper text during booking."
          rows={2}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cs-duration">Duration (min)</Label>
          <Input
            id="cs-duration"
            type="number"
            min={5}
            max={480}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-price">Price</Label>
          <Input
            id="cs-price"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="85.00"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cs-category">Category</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as ServiceCategory)}
          >
            <SelectTrigger id="cs-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Creating..." : "Create service"}
        </Button>
      </DialogFooter>
    </div>
  );
}
