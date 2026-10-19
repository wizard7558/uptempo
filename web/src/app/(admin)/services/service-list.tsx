"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  createService,
  updateService,
  deleteService,
  importServicePresets,
} from "@/actions/services";
import { createServiceCategory } from "@/actions/service-categories";
import { setServiceAddons } from "@/actions/service-addons";
import { setServiceNeeds } from "@/actions/services";
import type { ServiceNeedInput } from "@/lib/validators/resource";
import { ServiceNeeds, type ResourceOption } from "./service-needs";
import type { ServicePreset } from "@/lib/services/preset-catalog";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";
import {
  PlusIcon,
  PencilIcon,
  ClockIcon,
  TimerIcon,
  Trash2Icon,
  SparklesIcon,
  Users2Icon,
  EyeOffIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatServiceCategory } from "@/lib/services/categories";
import { formatCurrency } from "@/components/ui/chart-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Service {
  id: string;
  name: string;
  description?: string | null;
  defaultDurationMinutes: number;
  priceCents: number | null;
  costCents: number | null;
  category: string;
  activeMinutes: number | null;
  processingMinutes: number | null;
  isActive: number;
  assistantWorkflow: number;
  assistantTaskTypeId: string | null;
  onlineBookable: number;
  bookingAudience: "all" | "new" | "returning";
  priceDisplay: "show" | "starting" | "hidden";
  depositType: "none" | "percent" | "fixed" | null;
  depositAmount: number | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** null = use the business setting */
  minNoticeMin: number | null;
  maxAdvanceDays: number | null;
  slotIntervalMin: number | null;
  locationType: "in_studio" | "virtual" | "on_site";
  variantOfServiceId: string | null;
  isClass: number;
  classCapacity: number | null;
}

type LocationTypeValue = Service["locationType"];

const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];
const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];
const ADVANCE_OPTIONS = [7, 14, 28, 60, 90, 180, 365];
const INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60];
const USE_BUSINESS = "default";

interface TaskTypeOption {
  id: string;
  name: string;
}

interface CategoryOption {
  id: string;
  slug: string;
  name: string;
}

interface ServiceListProps {
  initialServices: Service[];
  assistantSettingsEnabled: boolean;
  taskTypes: TaskTypeOption[];
  /** Map of serviceId → number of active staff members currently offering it. */
  offeringCounts: Record<string, number>;
  /** Curated presets the business hasn't imported yet. */
  availablePresets: ServicePreset[];
  /** Business-defined categories (defaults + custom), ordered for display. */
  categories: CategoryOption[];
  /** Map of serviceId → add-on serviceIds attached to it. */
  addonsByService: Record<string, string[]>;
  /** Active rooms and equipment a service can need. */
  resources: ResourceOption[];
  /** Map of serviceId → what that service needs from rooms and equipment. */
  needsByService: Record<string, ServiceNeedInput[]>;
  /** Whether add-ons are available on the business's plan. */
  /** Whether deposits are available on the business's plan. */
  /** The classes module is on, so a service can run as a group class. */
  classesEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ServiceList({
  initialServices,
  assistantSettingsEnabled,
  taskTypes,
  offeringCounts,
  availablePresets,
  categories: initialCategories,
  addonsByService,
  resources,
  needsByService,
  classesEnabled,
}: ServiceListProps) {
  const t = useT("schedule");
  const [services, setServices] = useState(initialServices);
  const [categories, setCategories] = useState(initialCategories);
  const [editService, setEditService] = useState<Service | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presets, setPresets] = useState(availablePresets);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const categoryLabel = (slug: string) =>
    categories.find((c) => c.slug === slug)?.name ??
    formatServiceCategory(slug);
  const presetCategoryLabel = (slug: string) =>
    categories.find((c) => c.slug === slug)?.name ?? "Other";

  async function handleDelete(svc: Service) {
    if (
      !window.confirm(
        `Delete "${svc.name}"? It will be hidden from new bookings. Existing appointments are unaffected.`,
      )
    ) {
      return;
    }
    setDeletingId(svc.id);
    const result = await deleteService(svc.id);
    setDeletingId(null);
    if (result.success) {
      setServices((prev) => prev.filter((s) => s.id !== svc.id));
      toast.success("Service deleted");
    } else {
      toast.error(result.error?.message ?? "Failed to delete service");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger asChild>
            <Button>
              <PlusIcon className="mr-2 size-4" />
              Add Service
            </Button>
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col overflow-y-auto px-4 sm:w-[clamp(28rem,45vw,48rem)] sm:max-w-none sm:px-6">
            <SheetHeader className="px-0">
              <SheetTitle>Add Service</SheetTitle>
            </SheetHeader>
            <ServiceForm
              assistantSettingsEnabled={assistantSettingsEnabled}
              taskTypes={taskTypes}
              categories={categories}
              allServices={services}
              addonIds={[]}
              resources={resources}
              needs={[]}
              classesEnabled={classesEnabled}
              onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
              onSuccess={(svc) => {
                setServices((prev) => [...prev, svc]);
                setAddOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>

        {presets.length > 0 && (
          <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <SparklesIcon className="mr-2 size-4" />
                Add common services
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{t("serviceList.commonTitle")}</DialogTitle>
                <DialogDescription>
                  {t("serviceList.commonDescription")}
                </DialogDescription>
              </DialogHeader>
              <PresetPicker
                presets={presets}
                categoryLabel={presetCategoryLabel}
                onImported={(created, importedKeys) => {
                  setServices((prev) => [...prev, ...created]);
                  setPresets((prev) =>
                    prev.filter((p) => !importedKeys.includes(p.key)),
                  );
                  setPresetOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Service list */}
      <div className="divide-y rounded-lg border bg-card">
        {services.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No services yet. Add your first service to get started.
          </div>
        ) : (
          services.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{svc.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{categoryLabel(svc.category)}</Badge>
                  <Badge variant="secondary">
                    {svc.priceCents != null
                      ? svc.priceDisplay === "hidden"
                        ? "Price hidden"
                        : svc.priceDisplay === "starting"
                          ? `From ${formatCurrency(svc.priceCents)}`
                          : formatCurrency(svc.priceCents)
                      : "No default price"}
                  </Badge>
                  {svc.onlineBookable !== 0 && svc.bookingAudience !== "all" && (
                    <Badge variant="outline" className="gap-1">
                      {svc.bookingAudience === "new"
                        ? "New clients only"
                        : "Returning clients"}
                    </Badge>
                  )}
                  {svc.onlineBookable === 0 && (
                    <Badge variant="outline" className="gap-1">
                      <EyeOffIcon className="size-3" />
                      Internal only
                    </Badge>
                  )}
                  {svc.depositType &&
                    svc.depositType !== "none" && (
                      <Badge variant="outline">
                        Deposit{" "}
                        {svc.depositType === "percent"
                          ? `${svc.depositAmount ?? 0}%`
                          : formatCurrency(svc.depositAmount ?? 0)}
                      </Badge>
                    )}
                  {assistantSettingsEnabled && svc.assistantWorkflow === 1 && (
                    <Badge variant="outline">Assistant workflow</Badge>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ClockIcon className="size-3.5" />
                    {svc.defaultDurationMinutes} min
                  </span>
                  {svc.activeMinutes != null && svc.processingMinutes != null && (
                    <span className="flex items-center gap-1">
                      <TimerIcon className="size-3.5" />
                      {svc.activeMinutes} active + {svc.processingMinutes} processing
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users2Icon className="size-3.5" />
                    {(offeringCounts[svc.id] ?? 0) === 1
                      ? t("serviceList.offeredByOne")
                      : t("serviceList.offeredByMany", {
                          count: offeringCounts[svc.id] ?? 0,
                        })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Sheet
                  open={editService?.id === svc.id}
                  onOpenChange={(open) => {
                    if (!open) setEditService(null);
                  }}
                >
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditService(svc)}
                    >
                      <PencilIcon className="size-4" />
                      <span className="sr-only">Edit {svc.name}</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="flex w-full flex-col overflow-y-auto px-4 sm:w-[clamp(28rem,45vw,48rem)] sm:max-w-none sm:px-6">
                    <SheetHeader className="px-0">
                      <SheetTitle>Edit Service</SheetTitle>
                    </SheetHeader>
                    <ServiceForm
                      assistantSettingsEnabled={assistantSettingsEnabled}
                      taskTypes={taskTypes}
                      service={svc}
                      categories={categories}
                      allServices={services}
                      addonIds={addonsByService[svc.id] ?? []}
                      resources={resources}
                      needs={needsByService[svc.id] ?? []}
                      classesEnabled={classesEnabled}
                      onCategoryCreated={(c) =>
                        setCategories((prev) => [...prev, c])
                      }
                      onSuccess={(updated) => {
                        setServices((prev) =>
                          prev.map((s) => (s.id === updated.id ? updated : s)),
                        );
                        setEditService(null);
                      }}
                    />
                  </SheetContent>
                </Sheet>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={deletingId === svc.id}
                  onClick={() => handleDelete(svc)}
                >
                  <Trash2Icon className="size-4" />
                  <span className="sr-only">Delete {svc.name}</span>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "45 min", "2 hr", "1 day" for a span in minutes. */
function formatSpan(t: Translate, minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return t("serviceList.timing.days", { count: minutes / 1440 });
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return t("serviceList.timing.hours", { count: minutes / 60 });
  }
  return t("serviceList.timing.minutes", { count: minutes });
}

function TimingSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Form (Add/Edit)
// ---------------------------------------------------------------------------

interface ServiceFormProps {
  service?: Service;
  assistantSettingsEnabled: boolean;
  taskTypes: TaskTypeOption[];
  categories: CategoryOption[];
  /** All catalog services (for the add-on picker; the current service is excluded). */
  allServices: Service[];
  /** Add-on serviceIds currently linked to this service. */
  addonIds: string[];
  resources: ResourceOption[];
  /** What this service needs from rooms and equipment. */
  needs: ServiceNeedInput[];
  classesEnabled: boolean;
  onCategoryCreated: (category: CategoryOption) => void;
  onSuccess: (service: Service) => void;
}

function ServiceForm({
  service,
  assistantSettingsEnabled,
  taskTypes,
  categories,
  allServices,
  addonIds,
  resources,
  needs: initialNeeds,
  classesEnabled,
  onCategoryCreated,
  onSuccess,
}: ServiceFormProps) {
  const t = useT("schedule");
  const tc = useT("classes");
  const [isClass, setIsClass] = useState(service?.isClass === 1);
  const [classSpots, setClassSpots] = useState(
    service?.classCapacity != null ? String(service.classCapacity) : "",
  );
  const [needs, setNeeds] = useState<ServiceNeedInput[]>(initialNeeds);
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [duration, setDuration] = useState(
    service?.defaultDurationMinutes?.toString() ?? "",
  );
  const [price, setPrice] = useState(
    service?.priceCents != null ? (service.priceCents / 100).toFixed(2) : "",
  );
  const [cost, setCost] = useState(
    service?.costCents != null ? (service.costCents / 100).toFixed(2) : "",
  );
  const [category, setCategory] = useState<string>(
    service?.category ?? "other",
  );
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [priceDisplay, setPriceDisplay] = useState<
    "show" | "starting" | "hidden"
  >(service?.priceDisplay ?? "show");
  const [onlineBookable, setOnlineBookable] = useState(
    service?.onlineBookable !== 0,
  );
  const [bookingAudience, setBookingAudience] = useState<
    "all" | "new" | "returning"
  >(service?.bookingAudience ?? "all");
  const [depositType, setDepositType] = useState<
    "inherit" | "none" | "percent" | "fixed"
  >(service?.depositType ?? "inherit");
  const [depositAmountStr, setDepositAmountStr] = useState(
    service?.depositType === "percent"
      ? String(service.depositAmount ?? "")
      : service?.depositType === "fixed" && service.depositAmount != null
        ? (service.depositAmount / 100).toFixed(2)
        : "",
  );
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(
    new Set(addonIds),
  );
  const [hasProcessing, setHasProcessing] = useState(
    service?.activeMinutes != null && service?.processingMinutes != null,
  );
  const [activeMin, setActiveMin] = useState(
    service?.activeMinutes?.toString() ?? "",
  );
  const [processingMin, setProcessingMin] = useState(
    service?.processingMinutes?.toString() ?? "",
  );
  const [bufferBefore, setBufferBefore] = useState(
    String(service?.bufferBeforeMin ?? 0),
  );
  const [bufferAfter, setBufferAfter] = useState(
    String(service?.bufferAfterMin ?? 0),
  );
  const [minNotice, setMinNotice] = useState(
    service?.minNoticeMin != null ? String(service.minNoticeMin) : USE_BUSINESS,
  );
  const [maxAdvance, setMaxAdvance] = useState(
    service?.maxAdvanceDays != null ? String(service.maxAdvanceDays) : USE_BUSINESS,
  );
  const [slotInterval, setSlotInterval] = useState(
    service?.slotIntervalMin != null ? String(service.slotIntervalMin) : USE_BUSINESS,
  );
  const [locationType, setLocationType] = useState<LocationTypeValue>(
    service?.locationType ?? "in_studio",
  );
  const [variantOf, setVariantOf] = useState(service?.variantOfServiceId ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assistantWorkflow, setAssistantWorkflow] = useState(
    service?.assistantWorkflow === 1,
  );
  const [assistantTaskTypeId, setAssistantTaskTypeId] = useState(
    service?.assistantTaskTypeId ?? "",
  );

  // Candidate add-ons: every other active service.
  const otherServices = allServices.filter(
    (s) => s.id !== service?.id && s.isActive === 1,
  );

  async function handleCreateCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const result = await createServiceCategory({ name: trimmed });
    if (result.success) {
      onCategoryCreated({
        id: result.category.id,
        slug: result.category.slug,
        name: result.category.name,
      });
      setCategory(result.category.slug);
      setCreatingCategory(false);
      setNewCategoryName("");
    } else {
      toast.error("Could not create category");
    }
  }

  async function saveNeeds(serviceId: string) {
    const res = await setServiceNeeds(serviceId, needs);
    if (!res.success) toast.error(t("serviceList.needs.saveError"));
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const durationNum = parseInt(duration, 10);
    const activeNum = hasProcessing ? parseInt(activeMin, 10) : null;
    const processingNum = hasProcessing ? parseInt(processingMin, 10) : null;
    const trimmedPrice = price.trim();
    const priceNum = trimmedPrice === "" ? null : Math.round(Number(trimmedPrice) * 100);
    const trimmedCost = cost.trim();
    const costNum =
      trimmedCost === "" ? null : Math.round(Number(trimmedCost) * 100);

    // Client-side validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (isNaN(durationNum) || durationNum < 5) {
      setError("Duration must be at least 5 minutes");
      return;
    }
    if (
      trimmedPrice !== "" &&
      (!Number.isFinite(priceNum) || priceNum == null || priceNum < 0)
    ) {
      setError("Default price must be a valid dollar amount");
      return;
    }
    if (
      trimmedCost !== "" &&
      (!Number.isFinite(costNum) || costNum == null || costNum < 0)
    ) {
      setError("Estimated cost must be a valid dollar amount");
      return;
    }
    if (hasProcessing) {
      if (!activeNum || isNaN(activeNum) || activeNum < 1) {
        setError("Active minutes must be at least 1");
        return;
      }
      if (!processingNum || isNaN(processingNum) || processingNum < 1) {
        setError("Processing minutes must be at least 1");
        return;
      }
      if (activeNum + processingNum > durationNum) {
        setError("Active + Processing must not exceed total duration");
        return;
      }
    }

    // Resolve the deposit override into the stored (type, amount) shape.
    let depositTypeValue: "none" | "percent" | "fixed" | null = null;
    let depositAmountValue: number | null = null;
    if (depositType === "none") {
      depositTypeValue = "none";
    } else if (depositType === "percent") {
      const pct = parseInt(depositAmountStr, 10);
      if (isNaN(pct) || pct < 1 || pct > 100) {
        setError("Deposit percent must be between 1 and 100");
        return;
      }
      depositTypeValue = "percent";
      depositAmountValue = pct;
    } else if (depositType === "fixed") {
      const cents = Math.round(Number(depositAmountStr) * 100);
      if (!Number.isFinite(cents) || cents < 1) {
        setError("Fixed deposit must be a valid dollar amount");
        return;
      }
      depositTypeValue = "fixed";
      depositAmountValue = cents;
    }

    // A class needs a number of spots. Hidden (module off) keeps whatever the service already has.
    const classOn = classesEnabled ? isClass : service?.isClass === 1;
    let classCapacityValue: number | null = classOn ? (service?.classCapacity ?? null) : null;
    if (classesEnabled && isClass) {
      const spots = Number(classSpots);
      if (classSpots.trim() === "" || !Number.isInteger(spots) || spots < 1 || spots > 100) {
        setError(tc("errors.needSpots"));
        return;
      }
      classCapacityValue = spots;
    }

    startTransition(async () => {
      const data = {
        name: name.trim(),
        isClass: classOn ? 1 : 0,
        classCapacity: classCapacityValue,
        description: description.trim() === "" ? null : description.trim(),
        defaultDurationMinutes: durationNum,
        priceCents: priceNum,
        costCents: costNum,
        category,
        priceDisplay,
        onlineBookable: onlineBookable ? 1 : 0,
        bookingAudience,
        depositType: depositTypeValue,
        depositAmount: depositAmountValue,
        activeMinutes: activeNum,
        processingMinutes: processingNum,
        bufferBeforeMin: parseInt(bufferBefore, 10),
        bufferAfterMin: parseInt(bufferAfter, 10),
        minNoticeMin: minNotice === USE_BUSINESS ? null : parseInt(minNotice, 10),
        maxAdvanceDays: maxAdvance === USE_BUSINESS ? null : parseInt(maxAdvance, 10),
        slotIntervalMin: slotInterval === USE_BUSINESS ? null : parseInt(slotInterval, 10),
        locationType,
        variantOfServiceId: variantOf === "none" ? null : variantOf,
        assistantWorkflow: assistantSettingsEnabled
          ? assistantWorkflow
            ? 1
            : 0
          : undefined,
        assistantTaskTypeId:
          assistantSettingsEnabled && assistantWorkflow
            ? assistantTaskTypeId || null
            : assistantSettingsEnabled
              ? null
              : undefined,
      };

      if (service) {
        // Update
        const result = await updateService({ id: service.id, ...data });
        if (result.success) {
          await setServiceAddons({
            primaryServiceId: service.id,
            addonServiceIds: Array.from(selectedAddons),
          });
          await saveNeeds(service.id);
          toast.success("Service updated");
          onSuccess({
            ...service,
            ...data,
            description: data.description ?? null,
            assistantWorkflow: data.assistantWorkflow ?? service.assistantWorkflow,
            assistantTaskTypeId:
              data.assistantTaskTypeId !== undefined
                ? data.assistantTaskTypeId
                : service.assistantTaskTypeId,
          });
        } else {
          const msg =
            "error" in result && result.error && "message" in result.error
              ? (result.error as { message: string }).message
              : "Failed to update service";
          setError(msg);
        }
      } else {
        // Create
        const result = await createService(data);
        if (result.success) {
          if (selectedAddons.size > 0) {
            await setServiceAddons({
              primaryServiceId: result.id!,
              addonServiceIds: Array.from(selectedAddons),
            });
          }
          if (needs.length > 0) await saveNeeds(result.id!);
          toast.success("Service created");
          onSuccess({
            id: result.id!,
            name: data.name,
            description: data.description ?? null,
            defaultDurationMinutes: data.defaultDurationMinutes,
            priceCents: data.priceCents,
            costCents: data.costCents,
            category: data.category,
            priceDisplay: data.priceDisplay,
            onlineBookable: data.onlineBookable,
            bookingAudience: data.bookingAudience,
            depositType: data.depositType,
            depositAmount: data.depositAmount,
            activeMinutes: data.activeMinutes,
            processingMinutes: data.processingMinutes,
            bufferBeforeMin: data.bufferBeforeMin,
            bufferAfterMin: data.bufferAfterMin,
            minNoticeMin: data.minNoticeMin,
            maxAdvanceDays: data.maxAdvanceDays,
            slotIntervalMin: data.slotIntervalMin,
            locationType: data.locationType,
            variantOfServiceId: data.variantOfServiceId,
            isClass: data.isClass,
            classCapacity: data.classCapacity,
            isActive: 1,
            assistantWorkflow: data.assistantWorkflow ?? 0,
            assistantTaskTypeId: data.assistantTaskTypeId ?? null,
          });
        } else {
          const msg =
            "error" in result && result.error && "message" in result.error
              ? (result.error as { message: string }).message
              : "Failed to create service";
          setError(msg);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="service-name">Service Name</Label>
        <Input
          id="service-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Haircut, Color Service"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="service-description">Description (optional)</Label>
        <Textarea
          id="service-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shown as helper text when booking (great for add-ons)."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="service-duration">Total Duration (minutes)</Label>
        <Input
          id="service-duration"
          type="number"
          min={5}
          max={480}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="60"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="service-price">Default Price</Label>
          <Input
            id="service-price"
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="85.00"
          />
          <p className="text-xs text-muted-foreground">
            Used when this client does not have a custom price override.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="service-cost">Est. cost (optional)</Label>
          <Input
            id="service-cost"
            type="number"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
          />
          <p className="text-xs text-muted-foreground">
            Per service for COGS / gross margin on Analytics.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="service-category">Category</Label>
          {creatingCategory ? (
            <div className="flex gap-2">
              <Input
                id="service-category-new"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g., Maintenance"
                autoFocus
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleCreateCategory}
              >
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCategoryName("");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Select
              value={category}
              onValueChange={(value) => {
                if (value === "__new__") {
                  setCreatingCategory(true);
                  return;
                }
                setCategory(value);
              }}
            >
              <SelectTrigger id="service-category" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((option) => (
                  <SelectItem key={option.id} value={option.slug}>
                    {option.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">+ New category…</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Online booking visibility + how the price shows to clients */}
      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Switch
            id="online-bookable"
            checked={onlineBookable}
            onCheckedChange={setOnlineBookable}
          />
          <Label htmlFor="online-bookable" className="cursor-pointer leading-snug">
            Bookable online
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              Turn off to keep this service internal — staff can book it, clients
              can&apos;t see or self-book it.
            </span>
          </Label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="price-display">Price shown to clients</Label>
          <Select
            value={priceDisplay}
            onValueChange={(v) =>
              setPriceDisplay(v as "show" | "starting" | "hidden")
            }
          >
            <SelectTrigger id="price-display" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="show">Show price</SelectItem>
              <SelectItem value="starting">Starting at (From $X)</SelectItem>
              <SelectItem value="hidden">Hide price</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {onlineBookable && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="booking-audience">Who can book this online</Label>
            <Select
              value={bookingAudience}
              onValueChange={(v) =>
                setBookingAudience(v as "all" | "new" | "returning")
              }
            >
              <SelectTrigger id="booking-audience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="new">New clients only</SelectItem>
                <SelectItem value="returning">Returning clients only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Restrict who can self-book this service — e.g. keep new clients to
              a consultation first. You can always book anything for anyone from
              the schedule.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <Label htmlFor="deposit-type">Deposit</Label>
        <Select
          value={depositType}
          onValueChange={(v) =>
            setDepositType(v as "inherit" | "none" | "percent" | "fixed")
          }
        >
          <SelectTrigger id="deposit-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{t("serviceList.depositInherit")}</SelectItem>
            <SelectItem value="none">No deposit</SelectItem>
            <SelectItem value="percent">Percent of price</SelectItem>
            <SelectItem value="fixed">Fixed amount</SelectItem>
          </SelectContent>
        </Select>
        {(depositType === "percent" || depositType === "fixed") && (
          <div className="space-y-1">
            <Label htmlFor="deposit-amount" className="text-xs">
              {depositType === "percent" ? "Percent (1–100)" : "Amount ($)"}
            </Label>
            <Input
              id="deposit-amount"
              type="number"
              min={depositType === "percent" ? 1 : 0}
              max={depositType === "percent" ? 100 : undefined}
              step={depositType === "percent" ? 1 : 0.01}
              value={depositAmountStr}
              onChange={(e) => setDepositAmountStr(e.target.value)}
              placeholder={depositType === "percent" ? "25" : "50.00"}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t("serviceList.depositOverrideHint")}
        </p>
      </div>

      {otherServices.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label>Add-ons offered with this service</Label>
            <p className="text-xs text-muted-foreground">
              Clients booking this service can add these on. Add-ons are your
              other services (e.g. a weft install offered with a partial color).
            </p>
          </div>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {otherServices.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selectedAddons.has(s.id)}
                  onCheckedChange={() =>
                    setSelectedAddons((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                />
                <span className="flex-1 text-sm">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {s.priceCents != null ? formatCurrency(s.priceCents) : "—"} ·{" "}
                  {s.defaultDurationMinutes} min
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {classesEnabled && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Switch id="is-class" checked={isClass} onCheckedChange={setIsClass} />
            <Label htmlFor="is-class" className="cursor-pointer">
              {tc("isClass")}
            </Label>
          </div>
          {isClass && (
            <div className="space-y-2">
              <Label htmlFor="class-spots">{tc("spotsPerClass")}</Label>
              <Input
                id="class-spots"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                required
                value={classSpots}
                onChange={(e) => setClassSpots(e.target.value)}
                className="w-32"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border p-4">
        <Switch
          id="has-processing"
          checked={hasProcessing}
          onCheckedChange={(checked) => {
            setHasProcessing(checked);
            if (!checked) {
              setActiveMin("");
              setProcessingMin("");
            }
          }}
        />
        <Label htmlFor="has-processing" className="cursor-pointer">
          Has processing time (e.g., color, perm)
        </Label>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">{t("serviceList.timing.title")}</p>
          <p className="text-xs text-muted-foreground">{t("serviceList.timing.hint")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TimingSelect
            id="buffer-before"
            label={t("serviceList.timing.bufferBefore")}
            value={bufferBefore}
            onChange={setBufferBefore}
            options={BUFFER_OPTIONS.map((n) => ({
              value: String(n),
              label: n === 0 ? t("serviceList.timing.none") : formatSpan(t, n),
            }))}
          />
          <TimingSelect
            id="buffer-after"
            label={t("serviceList.timing.bufferAfter")}
            value={bufferAfter}
            onChange={setBufferAfter}
            options={BUFFER_OPTIONS.map((n) => ({
              value: String(n),
              label: n === 0 ? t("serviceList.timing.none") : formatSpan(t, n),
            }))}
          />
          <TimingSelect
            id="min-notice"
            label={t("serviceList.timing.minNotice")}
            value={minNotice}
            onChange={setMinNotice}
            options={[
              { value: USE_BUSINESS, label: t("serviceList.timing.useBusiness") },
              ...NOTICE_OPTIONS.map((n) => ({
                value: String(n),
                label: n === 0 ? t("serviceList.timing.none") : formatSpan(t, n),
              })),
            ]}
          />
          <TimingSelect
            id="max-advance"
            label={t("serviceList.timing.maxAdvance")}
            value={maxAdvance}
            onChange={setMaxAdvance}
            options={[
              { value: USE_BUSINESS, label: t("serviceList.timing.useBusiness") },
              ...ADVANCE_OPTIONS.map((n) => ({
                value: String(n),
                label: t("serviceList.timing.days", { count: n }),
              })),
            ]}
          />
          <TimingSelect
            id="slot-interval"
            label={t("serviceList.timing.interval")}
            value={slotInterval}
            onChange={setSlotInterval}
            options={[
              { value: USE_BUSINESS, label: t("serviceList.timing.useBusiness") },
              ...INTERVAL_OPTIONS.map((n) => ({
                value: String(n),
                label: t("serviceList.timing.minutes", { count: n }),
              })),
            ]}
          />
          <TimingSelect
            id="location-type"
            label={t("serviceList.timing.locationType")}
            value={locationType}
            onChange={(v) => setLocationType(v as LocationTypeValue)}
            options={[
              { value: "in_studio", label: t("serviceList.timing.inPerson") },
              { value: "virtual", label: t("serviceList.timing.online") },
              ...(service?.locationType === "on_site"
                ? [{ value: "on_site", label: t("serviceList.timing.onSite") }]
                : []),
            ]}
          />
        </div>
        <TimingSelect
          id="variant-of"
          label={t("serviceList.timing.variantOf")}
          value={variantOf}
          onChange={setVariantOf}
          options={[
            { value: "none", label: t("serviceList.timing.notVariant") },
            ...otherServices.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
      </div>

      <ServiceNeeds needs={needs} onChange={setNeeds} resources={resources} />

      {assistantSettingsEnabled && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Switch
              id="assistant-workflow"
              checked={assistantWorkflow}
              onCheckedChange={setAssistantWorkflow}
            />
            <Label htmlFor="assistant-workflow" className="cursor-pointer">
              {t("serviceList.assistantWorkflowLabel")}
            </Label>
          </div>
          {assistantWorkflow && taskTypes.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="assistant-task-type">Task label (optional)</Label>
              <Select
                value={assistantTaskTypeId || "__none__"}
                onValueChange={(v) =>
                  setAssistantTaskTypeId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger id="assistant-task-type">
                  <SelectValue placeholder="Use catalog name or service names" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Combine service names</SelectItem>
                  {taskTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("serviceList.assistantDefaultHint")}
              </p>
            </div>
          )}
        </div>
      )}

      {hasProcessing && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            Active + Processing must be &le; Total Duration. Remaining time is
            finishing work (rinse, style, etc.).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="active-min" className="text-xs">
                Active Minutes
              </Label>
              <Input
                id="active-min"
                type="number"
                min={1}
                max={480}
                value={activeMin}
                onChange={(e) => setActiveMin(e.target.value)}
                placeholder="45"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="processing-min" className="text-xs">
                Processing Minutes
              </Label>
              <Input
                id="processing-min"
                type="number"
                min={1}
                max={480}
                value={processingMin}
                onChange={(e) => setProcessingMin(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-2 space-y-2 border-t bg-background px-4 pb-4 pt-3 sm:-mx-6 sm:px-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending
            ? service
              ? "Updating..."
              : "Creating..."
            : service
              ? "Update Service"
              : "Create Service"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Preset picker
// ---------------------------------------------------------------------------

function PresetPicker({
  presets,
  categoryLabel,
  onImported,
}: {
  presets: ServicePreset[];
  categoryLabel: (slug: string) => string;
  onImported: (created: Service[], importedKeys: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(presets.map((p) => p.key)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function handleImport() {
    if (selected.size === 0) return;
    startTransition(async () => {
      const keys = Array.from(selected);
      const result = await importServicePresets(keys);
      if (!result.success) {
        toast.error(result.error?.message ?? "Failed to import presets");
        return;
      }
      const importedPresets = keys
        .map((k) => presets.find((p) => p.key === k))
        .filter((p): p is ServicePreset => !!p);

      const created: Service[] = result.ids.map((id, i) => {
        const p = importedPresets[i];
        return {
          id,
          name: p.name,
          description: p.description,
          defaultDurationMinutes: p.defaultDurationMinutes,
          priceCents: p.suggestedPriceCents,
          costCents: null,
          category: p.category,
          activeMinutes: p.activeMinutes ?? null,
          processingMinutes: p.processingMinutes ?? null,
          isActive: 1,
          assistantWorkflow: 0,
          assistantTaskTypeId: null,
          onlineBookable: 1,
          bookingAudience: "all" as const,
          priceDisplay: "show" as const,
          depositType: p.depositType ?? null,
          depositAmount: p.depositAmount ?? null,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          minNoticeMin: null,
          maxAdvanceDays: null,
          slotIntervalMin: null,
          locationType: "in_studio" as const,
          variantOfServiceId: null,
          isClass: p.isClass ?? 0,
          classCapacity: p.isClass === 1 ? (p.classCapacity ?? null) : null,
        };
      });
      toast.success(
        created.length === 1
          ? "1 service imported"
          : `${created.length} services imported`,
      );
      onImported(created, keys);
    });
  }

  const grouped = presets.reduce<Record<string, ServicePreset[]>>(
    (acc, preset) => {
      (acc[preset.category] ??= []).push(preset);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {selected.size} of {presets.length} selected
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            
            onClick={selectAll}
            disabled={selected.size === presets.length}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            
            onClick={clearAll}
            disabled={selected.size === 0}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {categoryLabel(category)}
            </p>
            {items.map((preset) => {
              const isChecked = selected.has(preset.key);
              return (
                <label
                  key={preset.key}
                  className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(preset.key)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{preset.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {preset.defaultDurationMinutes} min ·{" "}
                        {(preset.suggestedPriceCents / 100).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {preset.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>

      <DialogFooter>
        <Button
          onClick={handleImport}
          disabled={selected.size === 0 || isPending}
        >
          {isPending
            ? "Importing..."
            : selected.size === 0
              ? "Pick services to add"
              : `Add ${selected.size} ${selected.size === 1 ? "service" : "services"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}
