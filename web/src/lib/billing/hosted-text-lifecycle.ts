import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { HOSTED_TEXTS_METERED_LOOKUP_KEY } from "@/lib/billing/hosted-pricing";
import {
  resolvePriceIds,
  retrieveHostedSubscriptionInventory,
} from "@/lib/billing/subscriptions";
import { isSingleMode } from "@/lib/config/mode";
import { drizzleHostedTextStore, type HostedTextState, type HostedTextTenant, type HostedTextStore, type StatePatch, type LockDecision } from "./hosted-text-store";
export { drizzleHostedTextStore, type HostedTextState, type HostedTextTenant, type HostedTextStore, type LockDecision } from "./hosted-text-store";
import { getStripe } from "@/lib/stripe/server";
import {
  classifyBoundary,
  EvidenceConflict,
  hostedLifecycleEvent,
  listHostedLifecycleEvents,
  PAID_SUBSCRIPTION_STATUSES,
  type BoundaryEvidence,
  type LifecycleEvent,
  type PaidBoundary,
} from "@/lib/billing/subscription-webhook";

/**
 * Hosted text lifecycle (paid boundary plus the metered texts item).
 *
 * Stripe rejects a metered item create/update while the trial-end
 * `missing_payment_method: pause` setting is retained, so trials carry only
 * licensed items. Once a provider-proven paid boundary exists, one durable,
 * idempotent operation attaches the meter while switching that setting to
 * `create_invoice`. Every operation runs in three short DB phases with no
 * network inside a transaction: prepare (lock, recheck, commit intent),
 * dispatch (reread, frozen request), and settle (compare-and-set).
 */

/** Conservative bound inside Stripe's 24-hour idempotency retention. */
export const METER_OPERATION_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_STEPS = 6;
const WRITE_OPTIONS = { timeout: 30_000, maxNetworkRetries: 0 } as const;
const PENDING_STATES = new Set(["activating", "uncertain"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type TextMeterOutcome =
  | "skipped"
  | "free"
  | "unresolved"
  | "unsupported"
  | "ready"
  | "stopped"
  | "pending"
  | "uncertain";
export type TextMeterResult = { outcome: TextMeterOutcome; reason?: string };

let store: HostedTextStore = drizzleHostedTextStore;

/** Swap the DB surface in unit tests; call with no argument to restore it. */
export function setHostedTextStoreForTests(next?: HostedTextStore): void {
  store = next ?? drizzleHostedTextStore;
}

// ---- Durable meter operation envelope ----

export type MeterOperation = {
  v: 1;
  id: string;
  preparedAtMs: number;
  kind: "attach" | "detach";
  customerId: string;
  subscriptionId: string;
  priceId: string;
  meterItemId?: string;
};

/** Canonical, versioned JSON stored in hosted_text_billing_state.meter_operation_id. */
export function serializeMeterOperation(op: MeterOperation): string {
  return JSON.stringify({
    v: 1,
    id: op.id,
    preparedAtMs: op.preparedAtMs,
    kind: op.kind,
    customerId: op.customerId,
    subscriptionId: op.subscriptionId,
    priceId: op.priceId,
    ...(op.kind === "detach" ? { meterItemId: op.meterItemId } : {}),
  });
}

/** Parse a stored operation; any version, shape, or binding mismatch fails closed. */
export function parseMeterOperation(
  text: string | null,
  binding: { customerId: string; subscriptionId: string },
): MeterOperation {
  let op: Record<string, unknown>;
  try {
    op = JSON.parse(text ?? "") as Record<string, unknown>;
  } catch {
    throw new Error("Hosted text meter operation is not valid JSON.");
  }
  const nonEmpty = (value: unknown) => typeof value === "string" && value.length > 0;
  if (
    !op || typeof op !== "object" || op.v !== 1 ||
    typeof op.id !== "string" || !UUID.test(op.id) ||
    !Number.isSafeInteger(op.preparedAtMs) || (op.preparedAtMs as number) <= 0 ||
    (op.kind !== "attach" && op.kind !== "detach") ||
    op.customerId !== binding.customerId || op.subscriptionId !== binding.subscriptionId ||
    !nonEmpty(op.priceId) || (op.kind === "detach") !== nonEmpty(op.meterItemId) ||
    serializeMeterOperation(op as MeterOperation) !== text
  ) {
    throw new Error("Hosted text meter operation does not match its versioned binding.");
  }
  return op as MeterOperation;
}

// ---- Inventory and desire ----

type MeterItem = { id: string; priceId: string; created: number; marker: string | null };

export function meterItems(subscription: Stripe.Subscription): MeterItem[] {
  return subscription.items.data
    .filter((item) => item.price?.lookup_key === HOSTED_TEXTS_METERED_LOOKUP_KEY)
    .map((item) => ({
      id: item.id,
      priceId: item.price.id,
      created: item.created,
      marker: item.metadata?.hostedMeterOperationId ?? null,
    }));
}

/** Paid text billing is on: committed switch, not comped, and an eligible line. */
export function wantsTextMeter(tenant: HostedTextTenant): boolean {
  return (
    tenant.comped !== 1 &&
    tenant.billingSwitchedAt != null &&
    (tenant.smsLineStatus === "active" || tenant.smsLineStatus === "shared")
  );
}

function skipReason(tenant: HostedTextTenant | null): string | null {
  if (!tenant) return "no_tenant";
  if (tenant.comped === 1) return "comped";
  if (!tenant.subscriptionId || !tenant.customerId) return "no_subscription";
  if (tenant.billingSwitchedAt == null) return "awaiting_switch";
  return null;
}

/** Complete-inventory proof: the marked item exists (attach) or the stored item is gone (detach). */
function operationProof(op: MeterOperation, subscription: Stripe.Subscription): { done: boolean; itemId: string | null } {
  const items = subscription.items.data.map((item) => ({ id: item.id, priceId: item.price.id, marker: item.metadata?.hostedMeterOperationId, lookup: item.price.lookup_key }));
  if (op.kind === "detach") {
    return { done: !items.some((item) => item.id === op.meterItemId), itemId: null };
  }
  const marked = items.filter((item) => item.marker === op.id);
  const conflicting = items.some((item) => item.marker !== op.id &&
    (item.lookup === HOSTED_TEXTS_METERED_LOOKUP_KEY || item.priceId === op.priceId));
  if (conflicting || marked.length > 1 || (marked[0] &&
    (marked[0].priceId !== op.priceId || marked[0].lookup !== HOSTED_TEXTS_METERED_LOOKUP_KEY))) {
    throw new EvidenceConflict("Hosted text meter inventory conflicts with its operation.");
  }
  return { done: marked.length === 1, itemId: marked[0]?.id ?? null };
}

function boundaryOf(state: HostedTextState | null): PaidBoundary | null {
  if (!state?.billableFrom || !state.boundaryKind) return null;
  return { kind: state.boundaryKind, at: state.billableFrom, eventId: state.boundaryEventId };
}

function operationIdOf(state: HostedTextState | null): string | null {
  try {
    return state ? parseMeterOperation(state.meterOperationId, state).id : null;
  } catch {
    return null;
  }
}

const sameState = (a: HostedTextState | null, b: HostedTextState | null) =>
  JSON.stringify(a) === JSON.stringify(b);

// ---- Reconciler ----

type StepContext = {
  slug: string;
  now: () => Date;
  stripe: Stripe;
  tenant: HostedTextTenant & { customerId: string; subscriptionId: string };
};

/**
 * Converge the tenant's hosted text lifecycle with provider state: record the
 * paid boundary, then settle, dispatch, or commit one durable meter operation.
 * Throws on provider/DB failure (retryable); fail-closed states are returned.
 */
export async function reconcileHostedTextMeter(
  slug: string,
  options: { now?: () => Date; event?: Stripe.Event } = {},
): Promise<TextMeterResult> {
  if (isSingleMode()) return { outcome: "skipped", reason: "single_mode" };
  const now = options.now ?? (() => new Date());
  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await reconcileStep(slug, now, options.event);
    if (result !== "again") return result;
  }
  return { outcome: "pending", reason: "did_not_converge" };
}

async function reconcileStep(
  slug: string,
  now: () => Date,
  event?: Stripe.Event,
): Promise<TextMeterResult | "again"> {
  const tenant = await store.readTenant(slug);
  const skip = skipReason(tenant);
  if (skip) return { outcome: "skipped", reason: skip };
  const ctx: StepContext = { slug, now, stripe: getStripe(), tenant: tenant as StepContext["tenant"] };
  const binding = { slug, customerId: ctx.tenant.customerId, subscriptionId: ctx.tenant.subscriptionId };
  const state = await store.readState(slug);
  if (state && (state.customerId !== binding.customerId || state.subscriptionId !== binding.subscriptionId)) {
    await quarantine(slug, state);
    return { outcome: "unsupported", reason: "binding_mismatch" };
  }
  if (state?.billableFrom && state.lifecycleState === "unresolved") return { outcome: "unresolved", reason: "manual_review_hold" };
  try {
    const subscription = await retrieveHostedSubscriptionInventory(
      binding.subscriptionId, slug, binding.customerId, ctx.stripe);
    if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
      await quarantine(slug, state);
      return { outcome: "unsupported", reason: "terminal_subscription" };
    }
    const items = meterItems(subscription);
    const persisted = boundaryOf(state);
    let events: LifecycleEvent[] | null = [];
    if (persisted || (PAID_SUBSCRIPTION_STATUSES.has(subscription.status) && subscription.trial_end != null)) {
      events = await listHostedLifecycleEvents(ctx.stripe, subscription, binding, now().getTime(), persisted);
    }
    const webhookEvent = event ? hostedLifecycleEvent(event, binding) : null;
    if (events && webhookEvent && !events.some((e) => e.id === webhookEvent.id)) events.push(webhookEvent);
    const evidence = classifyBoundary(subscription, events, persisted);
    if (evidence.kind === "boundary" && state && PENDING_STATES.has(state.lifecycleState)) {
      return await continueOperation(ctx, state, subscription);
    }
    const attachPrice = evidence.kind === "boundary" && items.length === 0 && wantsTextMeter(ctx.tenant)
      ? (await resolvePriceIds([HOSTED_TEXTS_METERED_LOOKUP_KEY])).get(HOSTED_TEXTS_METERED_LOOKUP_KEY)!
      : null;
    return await store.locked(slug, (lockedTenant, lockedState) =>
      prepare(ctx, state, evidence, items, subscription.status === "active" ? attachPrice : null, lockedTenant, lockedState));
  } catch (error) {
    if (error instanceof EvidenceConflict) {
      await quarantine(slug, state);
      return { outcome: "unsupported", reason: "evidence_conflict" };
    }
    if (state?.lifecycleState === "ready") await quarantine(slug, state);
    throw error;
  }
}

/** A paid unresolved state is a durable manual-review quarantine; preserve all receipts. */
async function quarantine(slug: string, observed: HostedTextState | null): Promise<void> {
  await store.locked(slug, (_tenant, state) => state?.billableFrom && observed?.billableFrom &&
    state.customerId === observed.customerId && state.subscriptionId === observed.subscriptionId &&
    state.billableFrom.getTime() === observed.billableFrom.getTime()
    ? { patch: { lifecycleState: "unresolved" }, result: null } : { result: null });
}

/** Prepare transaction body: recheck locked rows, record facts, commit at most one intent. */
function prepare(
  ctx: StepContext,
  observed: HostedTextState | null,
  evidence: BoundaryEvidence,
  items: MeterItem[],
  attachPrice: string | null,
  tenant: HostedTextTenant | null,
  state: HostedTextState | null,
): LockDecision<TextMeterResult | "again"> {
  if (
    skipReason(tenant) || !sameState(state, observed) ||
    tenant!.customerId !== ctx.tenant.customerId || tenant!.subscriptionId !== ctx.tenant.subscriptionId ||
    wantsTextMeter(tenant!) !== wantsTextMeter(ctx.tenant)
  ) {
    return { result: "again" };
  }
  const insert = !state;
  if (evidence.kind === "unsupported") return { patch: state?.billableFrom ? { lifecycleState: "unresolved" } : undefined, result: { outcome: "unsupported", reason: evidence.reason } };
  if (evidence.kind !== "boundary") {
    if (evidence.kind === "free" && items.length > 0) return { result: { outcome: "unsupported", reason: "meter_during_trial" } };
    const lifecycleState = evidence.kind === "free" && !state?.billableFrom ? "free" : "unresolved";
    return { insert, patch: { lifecycleState }, result: { outcome: lifecycleState, ...(evidence.kind === "unresolved" ? { reason: evidence.reason } : {}) } };
  }
  const patch: StatePatch = {};
  if (!boundaryOf(state)) {
    const { at, kind, eventId } = evidence.boundary;
    Object.assign(patch, { billableFrom: at, boundaryKind: kind, boundaryEventId: eventId, nextUsageDate: state?.nextUsageDate ?? at.toISOString().slice(0, 10) });
  }
  const fail = (reason: string) => ({ insert, patch: { ...patch, lifecycleState: "unresolved" as const }, result: { outcome: "unsupported" as const, reason } });
  if (items.length > 1) return fail("duplicate_meter_items");
  const item = items[0] ?? null;
  const known = state?.meterItemId ?? null;
  if (known && item?.id !== known) return fail("meter_item_changed");
  if (!known && item?.marker && item.marker !== operationIdOf(state)) return fail("foreign_meter_operation");
  const desired = wantsTextMeter(tenant!);
  if (item && desired) return { insert, patch: { ...patch, lifecycleState: "ready", meterItemId: item.id }, result: { outcome: "ready" } };
  if (!item && !desired) return { insert, patch: { ...patch, lifecycleState: "stopped" }, result: { outcome: "stopped" } };
  // Only a verified-active subscription gets an attach intent; usage stays pending meanwhile.
  if (!item && !attachPrice) return { insert, patch: { ...patch, lifecycleState: "stopped" }, result: { outcome: "pending", reason: "subscription_not_active" } };
  const op: MeterOperation = {
    v: 1, id: randomUUID(), preparedAtMs: ctx.now().getTime(), kind: item ? "detach" : "attach",
    customerId: ctx.tenant.customerId, subscriptionId: ctx.tenant.subscriptionId,
    priceId: item ? item.priceId : attachPrice!, ...(item ? { meterItemId: item.id } : {}),
  };
  return {
    insert,
    patch: { ...patch, lifecycleState: "activating", meterOperationId: serializeMeterOperation(op), ...(item ? { meterItemId: item.id } : {}) },
    result: "again",
  };
}

/** Settle a proven operation, or dispatch the frozen request within its window. */
async function continueOperation(
  ctx: StepContext,
  state: HostedTextState,
  subscription: Stripe.Subscription,
): Promise<TextMeterResult | "again"> {
  let op: MeterOperation;
  try {
    op = parseMeterOperation(state.meterOperationId, state);
  } catch {
    await quarantine(ctx.slug, state);
    return { outcome: "unsupported", reason: "invalid_operation" };
  }
  const opText = state.meterOperationId!;
  const proof = operationProof(op, subscription);
  if (proof.done) return settle(ctx.slug, opText, op, proof.itemId);
  // Absence never proves a lost attach: beyond the window, reconcile is read-only.
  if (state.lifecycleState === "uncertain") return { outcome: "uncertain", reason: "operation_unconfirmed" };
  if (ctx.now().getTime() >= op.preparedAtMs + METER_OPERATION_WINDOW_MS) {
    await store.locked(ctx.slug, (_tenant, current) =>
      current?.meterOperationId === opText && current.lifecycleState === "activating"
        ? { patch: { lifecycleState: "uncertain" }, result: null }
        : { result: null });
    return { outcome: "uncertain", reason: "retry_window_expired" };
  }
  if (op.kind === "attach" && subscription.status !== "active") {
    return { outcome: "pending", reason: "subscription_not_active" };
  }
  // Last local phase: current tenant eligibility and the exact frozen intent
  // are checked together after all provider awaits. No network runs in this lock.
  const mayDispatch = await store.locked(ctx.slug, (tenant, current) => ({
    result: !!tenant && !!current && tenant.comped === 0 && tenant.billingSwitchedAt != null &&
      tenant.customerId === op.customerId && tenant.subscriptionId === op.subscriptionId &&
      current.customerId === op.customerId && current.subscriptionId === op.subscriptionId &&
      current.meterOperationId === opText && current.lifecycleState === "activating" &&
      (op.kind === "detach" || wantsTextMeter(tenant)),
  }));
  if (!mayDispatch) return { outcome: "pending", reason: "dispatch_state_changed" };

  let failure: unknown = null;
  const options = { idempotencyKey: `hosted-meter-v1:${op.id}`, ...WRITE_OPTIONS };
  try {
    if (op.kind === "attach") {
      await ctx.stripe.subscriptions.update(op.subscriptionId, {
        trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } },
        items: [{ price: op.priceId, metadata: { hostedMeterOperationId: op.id } }],
        proration_behavior: "none",
      }, options);
    } else {
      await ctx.stripe.subscriptionItems.del(op.meterItemId!, { proration_behavior: "none" }, options);
    }
  } catch (error) {
    failure = error;
  }
  // Request success is not proof; an in-progress or conflict response is not completion.
  const after = await retrieveHostedSubscriptionInventory(op.subscriptionId, ctx.slug, op.customerId, ctx.stripe);
  if (!PAID_SUBSCRIPTION_STATUSES.has(after.status)) {
    await quarantine(ctx.slug, await store.readState(ctx.slug));
    return { outcome: "unsupported", reason: "trial_or_pause_after_paid_boundary" };
  }
  const confirmed = operationProof(op, after);
  if (confirmed.done) return settle(ctx.slug, opText, op, confirmed.itemId);
  throw failure ?? new Error("Hosted text meter operation is not confirmed by provider inventory.");
}

/** Settle transaction: compare-and-set on the exact operation and its bindings. */
async function settle(
  slug: string,
  opText: string,
  op: MeterOperation,
  itemId: string | null,
): Promise<"again"> {
  await store.locked(slug, (tenant, state) => {
    if (
      !tenant || !state || state.meterOperationId !== opText || !PENDING_STATES.has(state.lifecycleState) ||
      tenant.customerId !== op.customerId || tenant.subscriptionId !== op.subscriptionId ||
      state.customerId !== op.customerId || state.subscriptionId !== op.subscriptionId
    ) {
      return { result: null };
    }
    if (op.kind === "detach") return { patch: { lifecycleState: "stopped", meterItemId: null }, result: null };
    // A late attach while texts are off records the item as not ready; the
    // next step commits a new detach operation for it.
    return { patch: { lifecycleState: wantsTextMeter(tenant) ? "ready" : "stopped", meterItemId: itemId }, result: null };
  });
  return "again";
}
