import { and, eq, isNull, or } from "drizzle-orm";
import type Stripe from "stripe";
import { HOSTED_PLAN_PURPOSE } from "@/lib/billing/hosted-catalog";
import { reconcileHostedTextMeter } from "@/lib/billing/hosted-text-lifecycle";
import { publicDb } from "@/lib/db";
import { tenants, type HostedTextBoundaryKind } from "@/lib/db/schema";
import { getInvoiceSubscriptionId } from "@/lib/stripe/invoice-subscription";
import { getStripe } from "@/lib/stripe/server";

/**
 * Platform webhook events that can concern a business's own hosted plan. The
 * same event types also carry client membership subscriptions, so the handler
 * decides by subscription metadata.
 */
export const HOSTED_PLAN_EVENT_TYPES: readonly string[] = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Mirror a hosted-plan subscription's status onto the public tenants row.
 * Returns true when the event belongs to the hosted plan (handled, even if no
 * row matched), false when the caller should keep processing it. Never touches
 * tenant schemas or client memberships.
 */
export async function handleHostedPlanEvent(
  event: Stripe.Event,
): Promise<boolean> {
  if (!HOSTED_PLAN_EVENT_TYPES.includes(event.type)) return false;
  if (event.account) return false;

  const isInvoice = event.type.startsWith("invoice.");
  let subscriptionId: string | undefined;
  let eventSubscription: Stripe.Subscription | undefined;
  if (isInvoice) {
    subscriptionId = getInvoiceSubscriptionId(
      event.data.object as Stripe.Invoice,
    );
  } else {
    eventSubscription = event.data.object as Stripe.Subscription;
    subscriptionId = eventSubscription.id;
    const purpose = eventSubscription.metadata?.purpose;
    if (purpose && purpose !== HOSTED_PLAN_PURPOSE) return false;
  }
  if (!subscriptionId) return false;

  // Events can arrive out of order: read the current status from Stripe.
  let sub: Stripe.Subscription;
  let fresh = true;
  try {
    sub = await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (!eventSubscription) return false;
    // Only a deletion may mirror the event's status; anything else is retried
    // so lifecycle evidence is never applied without a fresh read.
    if (event.type !== "customer.subscription.deleted") throw error;
    sub = eventSubscription;
    fresh = false;
  }

  const slug = sub.metadata?.tenantSlug;
  if (sub.metadata?.purpose !== HOSTED_PLAN_PURPOSE || !slug) return false;

  const updated = await publicDb
    .update(tenants)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenants.slug, slug),
        or(
          eq(tenants.stripeSubscriptionId, sub.id),
          isNull(tenants.stripeSubscriptionId),
        ),
      ),
    )
    .returning({ slug: tenants.slug });

  if (updated.length === 0) {
    console.warn(
      `Stripe webhook: hosted plan subscription ${sub.id} for ${slug} did not match a tenant row`,
    );
    return true;
  }

  // The verified event is transition evidence for the shared lifecycle. A
  // provider or DB failure throws, so Stripe retries the delivery.
  if (
    fresh &&
    !isInvoice &&
    sub.status !== "canceled" &&
    sub.status !== "incomplete_expired"
  ) {
    const meter = await reconcileHostedTextMeter(slug, { event });
    if (meter.reason === "did_not_converge") {
      throw new Error(`Hosted text activation for ${slug} did not converge; retry.`);
    }
  }
  return true;
}

// ---- Hosted text transition evidence ----

const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_MARGIN_S = 60 * 60;
const EVENT_PAGE_LIMIT = 50;
const LIFECYCLE_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.paused",
  "customer.subscription.resumed",
];
/** Statuses after a paid boundary; trialing and paused are free. */
export const PAID_SUBSCRIPTION_STATUSES = new Set(["active", "past_due", "unpaid"]);

export type LifecycleEvent = {
  id: string;
  type: string;
  created: number;
  status: string | null;
  previousStatus: string | null;
  trialEnd: number | null;
};
export type PaidBoundary = { kind: HostedTextBoundaryKind; at: Date; eventId: string | null };
export type BoundaryEvidence =
  | { kind: "free" }
  | { kind: "boundary"; boundary: PaidBoundary }
  | { kind: "unresolved" | "unsupported"; reason: string };

type BoundarySubscription = Pick<Stripe.Subscription, "status" | "created" | "trial_start" | "trial_end">;

/**
 * The paid boundary is the completed trial_end (natural conversion), the
 * resume event time (initial missing-card pause), or subscription creation
 * (no trial). It is never webhook arrival, meter creation, or midnight.
 * `events` is null when the bounded history is incomplete or expired.
 */
export function classifyBoundary(
  subscription: BoundarySubscription,
  events: LifecycleEvent[] | null,
  persisted: PaidBoundary | null,
): BoundaryEvidence {
  const unresolved = (reason: string) => ({ kind: "unresolved" as const, reason });
  const unsupported = (reason: string) => ({ kind: "unsupported" as const, reason });
  const pauses = (events ?? []).filter((e) => e.type === "customer.subscription.paused");
  const resumes = (events ?? []).filter((e) => e.type === "customer.subscription.resumed");

  if (subscription.status === "trialing" || subscription.status === "paused") {
    if (persisted) return unsupported("trial_or_pause_after_paid_boundary");
    if (subscription.status === "paused" && subscription.trial_start == null) {
      return unsupported("pause_without_trial");
    }
    return { kind: "free" };
  }
  if (!PAID_SUBSCRIPTION_STATUSES.has(subscription.status)) return unresolved(`status_${subscription.status}`);
  if (persisted) {
    if (events === null) return unresolved("history_incomplete");
    const later = events.filter((e) => (e.type === "customer.subscription.paused" || e.type === "customer.subscription.resumed" || e.status === "trialing" || e.status === "paused" || e.previousStatus === "trialing" || e.previousStatus === "paused") &&
      e.id !== persisted.eventId && e.created * 1000 > persisted.at.getTime());
    return later.length > 0 ? unsupported("pause_after_paid_boundary") : { kind: "boundary", boundary: persisted };
  }
  if (subscription.trial_start == null && subscription.trial_end == null) {
    if (pauses.length > 0 || resumes.length > 0) return unsupported("pause_without_trial");
    const created = events?.find((e) => e.type === "customer.subscription.created");
    return {
      kind: "boundary",
      boundary: { kind: "created", at: new Date(subscription.created * 1000), eventId: created?.id ?? null },
    };
  }
  if (events === null) return unresolved("history_incomplete");
  if (pauses.length > 1 || resumes.length > 1) return unsupported("repeated_pause");
  const conversions = events.filter((e) =>
    e.type === "customer.subscription.updated" && e.previousStatus === "trialing" &&
    e.status !== "trialing" && e.status !== "paused");
  if (resumes.length === 1) {
    const [pause, resume] = [pauses[0], resumes[0]!];
    if (!pause || pause.created > resume.created || conversions.length > 0) {
      return unresolved("resume_evidence_incomplete");
    }
    return { kind: "boundary", boundary: { kind: "resumed", at: new Date(resume.created * 1000), eventId: resume.id } };
  }
  if (pauses.length === 1) return unresolved("resume_evidence_missing");
  if (conversions.length > 1) return unsupported("repeated_trial_end");
  const conversion = conversions[0];
  if (!conversion || subscription.trial_end == null || conversion.trialEnd !== subscription.trial_end) {
    return unresolved("trial_end_evidence_missing");
  }
  return {
    kind: "boundary",
    boundary: { kind: "trial_end", at: new Date(subscription.trial_end * 1000), eventId: conversion.id },
  };
}

/** Provider evidence that contradicts the tenant binding or the stored operation. */
export class EvidenceConflict extends Error {}

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

/** Normalized facts from one event about exactly this tenant's hosted subscription. */
export function hostedLifecycleEvent(
  event: Stripe.Event,
  binding: { slug: string; customerId: string; subscriptionId: string },
): LifecycleEvent | null {
  if (event.account || !LIFECYCLE_EVENT_TYPES.includes(event.type)) return null;
  const object = event.data.object as Stripe.Subscription;
  if (object?.id !== binding.subscriptionId) return null;
  if (
    objectId(object.customer) !== binding.customerId ||
    object.metadata?.tenantSlug !== binding.slug ||
    object.metadata?.purpose !== HOSTED_PLAN_PURPOSE
  ) {
    throw new EvidenceConflict("Hosted subscription event ownership conflicts with its tenant.");
  }
  const previous = (event.data as { previous_attributes?: { status?: string } }).previous_attributes;
  return {
    id: event.id,
    type: event.type,
    created: event.created,
    status: object.status ?? null,
    previousStatus: previous?.status ?? null,
    trialEnd: object.trial_end ?? null,
  };
}

/** Bounded, paginated 30-day lifecycle history; null when incomplete or expired. */
export async function listHostedLifecycleEvents(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  binding: { slug: string; customerId: string; subscriptionId: string },
  nowMs: number,
  persisted: PaidBoundary | null = null,
): Promise<LifecycleEvent[] | null> {
  const retained = Math.ceil((nowMs - HISTORY_MS) / 1000) + HISTORY_MARGIN_S;
  const transitionStart = persisted ? Math.floor(persisted.at.getTime() / 1000) : (subscription.trial_end ?? subscription.created) - 300;
  if (!persisted && transitionStart < retained) return null;
  const since = Math.max(retained, transitionStart);
  const found: LifecycleEvent[] = [];
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < EVENT_PAGE_LIMIT; pageNumber++) {
    const page = await stripe.events.list(
      {
        types: LIFECYCLE_EVENT_TYPES,
        created: { gte: since },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    for (const event of page.data) {
      const normalized = hostedLifecycleEvent(event, binding);
      if (normalized) found.push(normalized);
    }
    if (!page.has_more) return found;
    const last = page.data.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }
  return null;
}
