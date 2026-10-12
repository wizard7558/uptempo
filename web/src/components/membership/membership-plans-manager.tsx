"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createMembershipPlan,
  listMembershipPlans,
  updateMembershipPlan,
} from "@/actions/membership";
import { toast } from "sonner";
import { useT } from "@/lib/terms/client";

type PlanRow = Awaited<ReturnType<typeof listMembershipPlans>>[number];

export type ServiceOption = { id: string; name: string };
type PlanKind = "stored_value" | "credits" | "discount";

interface Props {
  initialPlans: PlanRow[];
  services: ServiceOption[];
}

type CreditState = {
  kind: PlanKind;
  perPeriod: string;
  rollover: string;
  eligible: string[];
};

/** Reads and checks the credit fields. Returns a plain sentence when something is off. */
function creditPayload(c: CreditState): { error: string } | { values: Record<string, unknown> } {
  if (c.kind !== "credits") return { values: { kind: c.kind } };
  const per = Number.parseInt(c.perPeriod, 10);
  if (!Number.isInteger(per) || per < 1 || per > 30) {
    return { error: "perPeriod" };
  }
  const roll = Number.parseInt(c.rollover || "0", 10);
  if (!Number.isInteger(roll) || roll < 0 || roll > 10) {
    return { error: "rollover" };
  }
  return {
    values: {
      kind: c.kind,
      creditsPerPeriod: per,
      rolloverMax: roll,
      eligibleServiceIds: c.eligible,
    },
  };
}

function CreditFields({
  idPrefix,
  value,
  onChange,
  services,
  errorField,
}: {
  idPrefix: string;
  value: CreditState;
  onChange: (next: CreditState) => void;
  services: ServiceOption[];
  errorField: "perPeriod" | "rollover" | null;
}) {
  const t = useT("membership");
  const allServices = value.eligible.length === 0;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-kind`}>{t("plans.kindLabel")}</Label>
        <NativeSelect
          id={`${idPrefix}-kind`}
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as PlanKind })}
        >
          <option value="stored_value">{t("plans.kindStoredValue")}</option>
          <option value="credits">{t("plans.kindCredits")}</option>
          <option value="discount">{t("plans.kindDiscount")}</option>
        </NativeSelect>
      </div>
      {value.kind === "credits" && (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-per`}>{t("plans.perPeriod")}</Label>
            <Input
              id={`${idPrefix}-per`}
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              className="h-11"
              value={value.perPeriod}
              aria-invalid={errorField === "perPeriod"}
              onChange={(e) => onChange({ ...value, perPeriod: e.target.value })}
            />
            {errorField === "perPeriod" && (
              <p className="text-sm text-destructive">{t("plans.perPeriodError")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-roll`}>{t("plans.rollover")}</Label>
            <Input
              id={`${idPrefix}-roll`}
              type="number"
              inputMode="numeric"
              min={0}
              max={10}
              className="h-11"
              value={value.rollover}
              aria-invalid={errorField === "rollover"}
              onChange={(e) => onChange({ ...value, rollover: e.target.value })}
            />
            {errorField === "rollover" && (
              <p className="text-sm text-destructive">{t("plans.rolloverError")}</p>
            )}
          </div>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t("plans.which")}</legend>
            <label
              htmlFor={`${idPrefix}-all`}
              className="flex min-h-11 cursor-pointer items-center gap-3"
            >
              <Checkbox
                id={`${idPrefix}-all`}
                className="size-5"
                checked={allServices}
                onCheckedChange={(v) =>
                  onChange({
                    ...value,
                    eligible: v === true ? [] : services.map((sv) => sv.id),
                  })
                }
              />
              <span className="text-sm">{t("plans.all")}</span>
            </label>
            {!allServices &&
              services.map((sv) => (
                <label
                  key={sv.id}
                  htmlFor={`${idPrefix}-svc-${sv.id}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 pl-6"
                >
                  <Checkbox
                    id={`${idPrefix}-svc-${sv.id}`}
                    className="size-5"
                    checked={value.eligible.includes(sv.id)}
                    onCheckedChange={(v) => {
                      const next =
                        v === true
                          ? [...value.eligible, sv.id]
                          : value.eligible.filter((x) => x !== sv.id);
                      // Unticking the last one would silently mean "all"; keep the list non-empty.
                      onChange({ ...value, eligible: next.length === 0 ? [sv.id] : next });
                    }}
                  />
                  <span className="text-sm">{sv.name}</span>
                </label>
              ))}
          </fieldset>
        </>
      )}
    </div>
  );
}

export function MembershipPlansManager({ initialPlans, services }: Props) {
  const t = useT("membership");
  const [plans, setPlans] = useState(initialPlans);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState(t("plansManager.defaultName"));
  const [monthlyDollars, setMonthlyDollars] = useState("100");
  const [retailPct, setRetailPct] = useState("20");
  const [priority, setPriority] = useState(true);
  const [priorityDays, setPriorityDays] = useState("14");
  const [allowCustom, setAllowCustom] = useState(false);
  const [credit, setCredit] = useState<CreditState>({
    kind: "stored_value",
    perPeriod: "4",
    rollover: "0",
    eligible: [],
  });
  const [creditError, setCreditError] = useState<"perPeriod" | "rollover" | null>(null);

  function handleCreate() {
    const dollars = Number.parseFloat(monthlyDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a valid monthly amount");
      return;
    }
    const payload = creditPayload(credit);
    if ("error" in payload) {
      setCreditError(payload.error as "perPeriod" | "rollover");
      return;
    }
    setCreditError(null);
    const monthlyAmountCents = Math.round(dollars * 100);
    startTransition(async () => {
      const result = await createMembershipPlan({
        name: name.trim() || "Membership",
        monthlyAmountCents,
        retailDiscountPercent: Number.parseInt(retailPct, 10) || 0,
        priorityBooking: priority,
        priorityBookingDays: Number.parseInt(priorityDays, 10) || 14,
        allowCustomAmount: allowCustom,
        ...payload.values,
      });
      if (result.success) {
        toast.success("Plan created");
        window.location.reload();
      } else {
        toast.error("Could not create plan");
      }
    });
  }

  function toggleActive(plan: PlanRow, next: boolean) {
    startTransition(async () => {
      await updateMembershipPlan(plan.id, { isActive: next });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === plan.id ? { ...p, isActive: next ? 1 : 0 } : p,
        ),
      );
      toast.success(next ? "Plan activated" : "Plan deactivated");
    });
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>New plan</CardTitle>
          <CardDescription>
            Creates a Stripe product/price for recurring billing. Amounts are in
            USD.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-amt">Monthly amount (USD)</Label>
            <Input
              id="plan-amt"
              type="number"
              min={1}
              step="0.01"
              value={monthlyDollars}
              onChange={(e) => setMonthlyDollars(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="retail">
              {t("plansManager.discountLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("plansManager.discountHint")}
            </p>
            <Input
              id="retail"
              type="number"
              min={0}
              max={100}
              value={retailPct}
              onChange={(e) => setRetailPct(e.target.value)}
            />
          </div>
          <CreditFields
            idPrefix="new-plan"
            value={credit}
            onChange={setCredit}
            services={services}
            errorField={creditError}
          />
          <div className="flex items-center gap-2">
            <Switch
              id="priority"
              checked={priority}
              onCheckedChange={setPriority}
            />
            <Label htmlFor="priority">Priority booking (extra days)</Label>
          </div>
          {priority && (
            <div className="space-y-2">
              <Label htmlFor="days">Extra booking horizon (days)</Label>
              <Input
                id="days"
                type="number"
                min={1}
                max={365}
                value={priorityDays}
                onChange={(e) => setPriorityDays(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-start gap-2">
            <Switch
              id="allow-custom"
              checked={allowCustom}
              onCheckedChange={setAllowCustom}
            />
            <Label htmlFor="allow-custom" className="leading-snug">
              Let clients choose their own amount
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Members can contribute any whole-dollar amount at or above this
                plan&apos;s price.
              </span>
            </Label>
          </div>
          <Button  onClick={handleCreate} disabled={pending}>
            Create plan
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Existing plans</h2>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plans yet.</p>
        ) : (
          <ul className="space-y-2">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3"
              >
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    ${(p.monthlyAmountCents / 100).toFixed(2)}/mo ·{" "}
                    {p.retailDiscountPercent}% BB full-pay ·
                    {p.priorityBooking === 1
                      ? ` +${p.priorityBookingDays}d priority`
                      : " no priority"}
                  </p>
                  {p.stripePriceId && (
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {p.stripePriceId}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    
                    onClick={() =>
                      setEditingId((id) => (id === p.id ? null : p.id))
                    }
                  >
                    {editingId === p.id ? "Close" : "Edit"}
                  </Button>
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Switch
                    checked={p.isActive === 1}
                    onCheckedChange={(v) => toggleActive(p, v)}
                    disabled={pending}
                  />
                </div>
                {editingId === p.id && (
                  <EditPlanForm
                    plan={p}
                    services={services}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => window.location.reload()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EditPlanForm({
  plan,
  services,
  onCancel,
  onSaved,
}: {
  plan: PlanRow;
  services: ServiceOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(plan.name);
  const [monthlyDollars, setMonthlyDollars] = useState(
    (plan.monthlyAmountCents / 100).toFixed(2),
  );
  const [retailPct, setRetailPct] = useState(String(plan.retailDiscountPercent));
  const [priority, setPriority] = useState(plan.priorityBooking === 1);
  const [priorityDays, setPriorityDays] = useState(
    String(plan.priorityBookingDays),
  );
  const [description, setDescription] = useState(plan.description ?? "");
  const [allowCustom, setAllowCustom] = useState(plan.allowCustomAmount === 1);
  const [credit, setCredit] = useState<CreditState>({
    kind: plan.kind as PlanKind,
    perPeriod: String(plan.creditsPerPeriod ?? 4),
    rollover: String(plan.rolloverMax),
    eligible: plan.eligibleServiceIds,
  });
  const [creditError, setCreditError] = useState<"perPeriod" | "rollover" | null>(null);

  const priceChanged =
    Math.round(Number.parseFloat(monthlyDollars || "0") * 100) !==
    plan.monthlyAmountCents;

  function save() {
    const dollars = Number.parseFloat(monthlyDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error("Enter a valid monthly amount");
      return;
    }
    const payload = creditPayload(credit);
    if ("error" in payload) {
      setCreditError(payload.error as "perPeriod" | "rollover");
      return;
    }
    setCreditError(null);
    startTransition(async () => {
      const res = await updateMembershipPlan(plan.id, {
        name: name.trim() || plan.name,
        monthlyAmountCents: Math.round(dollars * 100),
        retailDiscountPercent: Number.parseInt(retailPct, 10) || 0,
        priorityBooking: priority,
        priorityBookingDays: Number.parseInt(priorityDays, 10) || 14,
        description: description.trim() || null,
        allowCustomAmount: allowCustom,
        ...payload.values,
      });
      if (res.success) {
        toast.success("Plan updated");
        onSaved();
      } else {
        toast.error("Could not update plan");
      }
    });
  }

  return (
    <div className="mt-3 w-full space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`edit-name-${plan.id}`}>Name</Label>
          <Input
            id={`edit-name-${plan.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-amt-${plan.id}`}>Monthly amount (USD)</Label>
          <Input
            id={`edit-amt-${plan.id}`}
            type="number"
            min={1}
            step="0.01"
            value={monthlyDollars}
            onChange={(e) => setMonthlyDollars(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-retail-${plan.id}`}>BB full-pay discount (%)</Label>
          <Input
            id={`edit-retail-${plan.id}`}
            type="number"
            min={0}
            max={100}
            value={retailPct}
            onChange={(e) => setRetailPct(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-days-${plan.id}`}>Priority days</Label>
          <Input
            id={`edit-days-${plan.id}`}
            type="number"
            min={0}
            max={365}
            value={priorityDays}
            onChange={(e) => setPriorityDays(e.target.value)}
            disabled={!priority}
          />
        </div>
      </div>
      <CreditFields
        idPrefix={`edit-${plan.id}`}
        value={credit}
        onChange={setCredit}
        services={services}
        errorField={creditError}
      />
      <div className="flex items-center gap-2">
        <Switch
          id={`edit-priority-${plan.id}`}
          checked={priority}
          onCheckedChange={setPriority}
        />
        <Label htmlFor={`edit-priority-${plan.id}`}>Priority booking</Label>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          id={`edit-allow-custom-${plan.id}`}
          checked={allowCustom}
          onCheckedChange={setAllowCustom}
        />
        <Label
          htmlFor={`edit-allow-custom-${plan.id}`}
          className="leading-snug"
        >
          Let clients choose their own amount
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            Members can contribute any whole-dollar amount at or above this
            plan&apos;s price.
          </span>
        </Label>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`edit-desc-${plan.id}`}>Description (optional)</Label>
        <Textarea
          id={`edit-desc-${plan.id}`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {priceChanged && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Changing the price only affects new enrollments. Current subscribers
          keep their price until they cancel and re-enroll.
        </p>
      )}
      <div className="flex gap-2">
        <Button  onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <Button variant="ghost" className="h-11" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
