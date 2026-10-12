"use server";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { getActorStaffId } from "@/lib/auth/actor-staff";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { assertModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { getVertical } from "@/lib/verticals";
import { listAttachments, type AttachmentView } from "@/lib/attachments/service";
import { resolveRequestFields, type RequestFieldDef } from "@/lib/requests/fields";
import { expireStaleQuotes } from "@/lib/requests/expire";
import { absoluteQuoteUrl, deliverQuote } from "@/lib/requests/deliver";
import { canTransitionRequest, type QuoteStatus, type RequestStatus } from "@/lib/requests/status";
import { attributeFilterFor, listDefinitions } from "@/lib/custom-fields/service";

export type RequestFilter = "open" | "quoted" | "booked" | "closed" | "all";

const FILTER_STATUSES: Record<Exclude<RequestFilter, "all">, RequestStatus[]> = {
  open: ["new", "reviewing"],
  quoted: ["quoted", "accepted"],
  booked: ["converted"],
  closed: ["declined", "expired"],
};

export type RequestRow = {
  id: string;
  status: RequestStatus;
  createdAt: Date;
  clientId: string;
  clientName: string;
  serviceName: string | null;
  /** One line about what they want: the service, else the first thing they wrote. */
  summary: string;
  staffId: string | null;
  quoteStatus: QuoteStatus | null;
  quoteTotalCents: number | null;
};

export type QuoteLine = {
  id: string;
  serviceId: string;
  description: string;
  quantity: number;
  unitCents: number;
  minutes: number;
};

export type QuoteView = {
  id: string;
  status: QuoteStatus;
  staffId: string | null;
  subtotalCents: number;
  depositCents: number;
  message: string | null;
  /** Accepting creates a multi-session project with this many sessions; null for none. */
  projectSessions: number | null;
  validUntil: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  lines: QuoteLine[];
  link: string;
};

export type RequestDetail = {
  request: {
    id: string;
    status: RequestStatus;
    serviceId: string | null;
    serviceName: string | null;
    staffId: string | null;
    createdAt: Date;
    declineReason: string | null;
    preferredWindows: { days: number[]; parts: ("morning" | "afternoon" | "evening")[] }[];
  };
  client: { id: string; name: string; phone: string | null; email: string | null };
  answers: Record<string, unknown>;
  attributes: Record<string, unknown>;
  fields: RequestFieldDef[];
  photos: AttachmentView[];
  quotes: QuoteView[];
};

type Failure = { success: false; error: string };
type Guard = Awaited<ReturnType<typeof guard>>;

/** Staff session + module gate. Providers are limited to their own requests via `canTouch`. */
async function guard() {
  const auth = await requireRole("owner", "admin", "provider");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "requests");
  const actorStaffId = auth.role === "provider" ? await getActorStaffId(slug, auth.userId) : null;
  const [te, tr] = await Promise.all([getT("errors", slug), getT("requests", slug)]);
  return { slug, role: auth.role, userId: auth.userId, actorStaffId, te, tr };
}

const canTouch = (g: Guard, requestStaffId: string | null) =>
  g.role !== "provider" || requestStaffId === null || requestStaffId === g.actorStaffId;

const fail = (error: string): Failure => ({ success: false, error });

/** Turns a thrown module-off error into the sentence the owner should see. */
function asFailure(err: unknown): Failure {
  if (err instanceof ModuleDisabledError) return fail(err.message);
  throw err;
}

function summarize(answers: Record<string, unknown>): string {
  for (const key of ["description", "placement", "style"]) {
    const v = answers[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 140);
  }
  for (const v of Object.values(answers)) {
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 140);
  }
  return "";
}

export async function listRequests(
  filter: RequestFilter = "open",
  attributeFilter?: { key: string; value: string },
): Promise<RequestRow[]> {
  await requireStaff();
  const g = await guard();
  const defs = attributeFilter ? await listDefinitions(g.slug, "request") : [];
  return withTenantDb(g.slug, async (db, t) => {
    await expireStaleQuotes(db, t);
    const statusWhere =
      filter === "all" ? undefined : inArray(t.bookingRequests.status, FILTER_STATUSES[filter]);
    const rows = await db
      .select({
        id: t.bookingRequests.id,
        status: t.bookingRequests.status,
        createdAt: t.bookingRequests.createdAt,
        clientId: t.clients.id,
        clientName: t.clients.name,
        serviceName: t.services.name,
        answers: t.bookingRequests.answers,
        staffId: t.bookingRequests.staffId,
      })
      .from(t.bookingRequests)
      .innerJoin(t.clients, eq(t.clients.id, t.bookingRequests.clientId))
      .leftJoin(t.services, eq(t.services.id, t.bookingRequests.serviceId))
      .where(and(statusWhere, attributeFilterFor(defs, t.bookingRequests.attributes, attributeFilter)))
      .orderBy(desc(t.bookingRequests.createdAt))
      .limit(200);
    if (rows.length === 0) return [];
    const quotes = await db
      .select({
        requestId: t.quotes.requestId,
        status: t.quotes.status,
        subtotalCents: t.quotes.subtotalCents,
      })
      .from(t.quotes)
      .where(inArray(t.quotes.requestId, rows.map((r) => r.id)))
      .orderBy(desc(t.quotes.createdAt));
    const latest = new Map<string, (typeof quotes)[number]>();
    for (const q of quotes) if (!latest.has(q.requestId)) latest.set(q.requestId, q);
    return rows.map((r) => ({
      id: r.id,
      status: r.status as RequestStatus,
      createdAt: r.createdAt,
      clientId: r.clientId,
      clientName: r.clientName,
      serviceName: r.serviceName,
      summary: r.serviceName ?? summarize(r.answers),
      staffId: r.staffId,
      quoteStatus: (latest.get(r.id)?.status as QuoteStatus | undefined) ?? null,
      quoteTotalCents: latest.get(r.id)?.subtotalCents ?? null,
    }));
  });
}

export async function getRequestDetail(id: string): Promise<RequestDetail | null> {
  await requireStaff();
  const g = await guard();
  const tenant = await getTenantBySlug(g.slug);
  const data = await withTenantDb(g.slug, async (db, t) => {
    await expireStaleQuotes(db, t);
    const [row] = await db
      .select({
        id: t.bookingRequests.id,
        status: t.bookingRequests.status,
        serviceId: t.bookingRequests.serviceId,
        serviceName: t.services.name,
        staffId: t.bookingRequests.staffId,
        createdAt: t.bookingRequests.createdAt,
        declineReason: t.bookingRequests.declineReason,
        answers: t.bookingRequests.answers,
        attributes: t.bookingRequests.attributes,
        preferredWindows: t.bookingRequests.preferredWindows,
        clientId: t.clients.id,
        clientName: t.clients.name,
        clientPhone: t.clients.phone,
        clientEmail: t.clients.email,
      })
      .from(t.bookingRequests)
      .innerJoin(t.clients, eq(t.clients.id, t.bookingRequests.clientId))
      .leftJoin(t.services, eq(t.services.id, t.bookingRequests.serviceId))
      .where(eq(t.bookingRequests.id, id))
      .limit(1);
    if (!row) return null;
    const quoteRows = await db
      .select()
      .from(t.quotes)
      .where(eq(t.quotes.requestId, id))
      .orderBy(desc(t.quotes.createdAt));
    const lineRows = quoteRows.length
      ? await db
          .select()
          .from(t.quoteLineItems)
          .where(inArray(t.quoteLineItems.quoteId, quoteRows.map((q) => q.id)))
          .orderBy(asc(t.quoteLineItems.sort))
      : [];
    return { row, quoteRows, lineRows };
  });
  if (!data || !canTouch(g, data.row.staffId)) return null;
  const { row, quoteRows, lineRows } = data;
  const photos = await listAttachments(g.slug, "request", id);
  return {
    request: {
      id: row.id,
      status: row.status as RequestStatus,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      staffId: row.staffId,
      createdAt: row.createdAt,
      declineReason: row.declineReason,
      preferredWindows: row.preferredWindows,
    },
    client: { id: row.clientId, name: row.clientName, phone: row.clientPhone, email: row.clientEmail },
    answers: row.answers,
    attributes: row.attributes ?? {},
    fields: resolveRequestFields(getVertical(tenant?.industry).requestFields),
    photos,
    quotes: quoteRows.map((q) => ({
      id: q.id,
      status: q.status as QuoteStatus,
      staffId: q.staffId,
      subtotalCents: q.subtotalCents,
      depositCents: q.depositCents,
      message: q.message,
      projectSessions: q.projectSessions,
      validUntil: q.validUntil,
      sentAt: q.sentAt,
      createdAt: q.createdAt,
      link: absoluteQuoteUrl(g.slug, q.accessToken),
      lines: lineRows
        .filter((l) => l.quoteId === q.id)
        .map((l) => ({
          id: l.id,
          serviceId: l.serviceId,
          description: l.description,
          quantity: l.quantity,
          unitCents: l.unitCents,
          minutes: l.minutes,
        })),
    })),
  };
}

/** Opening a new request marks it "in review". Anything not new is left alone. */
export async function markRequestReviewing(id: string): Promise<void> {
  await requireStaff();
  const g = await guard();
  await withTenantDb(g.slug, async (db, t) => {
    const [req] = await db
      .select({ staffId: t.bookingRequests.staffId })
      .from(t.bookingRequests)
      .where(eq(t.bookingRequests.id, id))
      .limit(1);
    if (!req || !canTouch(g, req.staffId)) return;
    await db
      .update(t.bookingRequests)
      .set({ status: "reviewing", reviewedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(t.bookingRequests.id, id), eq(t.bookingRequests.status, "new")));
  });
}

const validDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)]);

const lineSchema = z.object({
  serviceId: z.uuid(),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(100),
  unitCents: z.number().int().min(0).max(10_000_000),
  minutes: z.number().int().min(0).max(1440),
});

const draftSchema = z.object({
  requestId: z.uuid(),
  quoteId: z.uuid().optional(),
  staffId: z.uuid().nullable(),
  lines: z.array(lineSchema).min(1).max(20),
  depositCents: z.number().int().min(0).max(10_000_000),
  validDays: validDaysSchema,
  message: z.string().trim().max(2000).optional(),
  /** Track the job as a multi-session project: 2 to 12 sessions, or null for a single visit. */
  projectSessions: z.number().int().min(2).max(12).nullable().optional(),
});

export type SaveQuoteDraftInput = z.input<typeof draftSchema>;

/** Creates a draft, or replaces the lines of an existing draft. Sent quotes are never edited. */
export async function saveQuoteDraft(
  input: SaveQuoteDraftInput,
): Promise<{ success: true; quoteId: string } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return fail(g.te("requests.invalid"));
    const d = parsed.data;
    const subtotal = d.lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0);
    if (d.depositCents > subtotal) return fail(g.te("requests.depositTooHigh"));
    const projectSessions = d.projectSessions ?? null;
    if (projectSessions != null) await assertModule(g.slug, "projects");

    const result = await withTenantDb(g.slug, async (db, t) =>
      db.transaction(async (tx) => {
        const [req] = await tx
          .select({ status: t.bookingRequests.status, staffId: t.bookingRequests.staffId })
          .from(t.bookingRequests)
          .where(eq(t.bookingRequests.id, d.requestId))
          .for("update");
        if (!req) return fail(g.te("requests.badState"));
        if (!canTouch(g, req.staffId)) return fail(g.te("requests.notAllowed"));
        if (!canTransitionRequest(req.status as RequestStatus, "quoted")) return fail(g.te("requests.badState"));

        const serviceIds = [...new Set(d.lines.map((l) => l.serviceId))];
        const found = await tx
          .select({ id: t.services.id })
          .from(t.services)
          .where(inArray(t.services.id, serviceIds));
        if (found.length !== serviceIds.length) return fail(g.te("requests.invalid"));
        if (d.staffId) {
          const [member] = await tx
            .select({ id: t.staff.id })
            .from(t.staff)
            .where(and(eq(t.staff.id, d.staffId), eq(t.staff.isActive, 1)))
            .limit(1);
          if (!member) return fail(g.te("requests.invalid"));
        }

        const validUntil = sql`now() + make_interval(days => ${d.validDays})`;
        let quoteId = d.quoteId;
        if (quoteId) {
          const [existing] = await tx
            .select({ status: t.quotes.status, requestId: t.quotes.requestId })
            .from(t.quotes)
            .where(eq(t.quotes.id, quoteId))
            .for("update");
          if (!existing || existing.requestId !== d.requestId || existing.status !== "draft") {
            return fail(g.te("requests.badState"));
          }
          await tx
            .update(t.quotes)
            .set({
              staffId: d.staffId,
              subtotalCents: subtotal,
              depositCents: d.depositCents,
              message: d.message || null,
              projectSessions,
              validUntil,
              updatedAt: sql`now()`,
            })
            .where(eq(t.quotes.id, quoteId));
          await tx.delete(t.quoteLineItems).where(eq(t.quoteLineItems.quoteId, quoteId));
        } else {
          const [created] = await tx
            .insert(t.quotes)
            .values({
              requestId: d.requestId,
              staffId: d.staffId,
              status: "draft",
              accessToken: randomBytes(24).toString("base64url"),
              subtotalCents: subtotal,
              depositCents: d.depositCents,
              message: d.message || null,
              projectSessions,
              validUntil,
              createdBy: g.userId,
            })
            .returning({ id: t.quotes.id });
          quoteId = created.id;
        }
        await tx.insert(t.quoteLineItems).values(
          d.lines.map((l, i) => ({
            quoteId: quoteId!,
            serviceId: l.serviceId,
            description: l.description,
            quantity: l.quantity,
            unitCents: l.unitCents,
            minutes: l.minutes,
            sort: i,
          })),
        );
        return { success: true as const, quoteId: quoteId! };
      }),
    );
    if (result.success) revalidatePath(`/requests/${d.requestId}`);
    return result;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function sendQuote(
  quoteId: string,
  validDays: 7 | 14 | 30 | 60 = 14,
): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    if (!validDaysSchema.safeParse(validDays).success) return fail(g.te("requests.invalid"));
    let result: { success: true; requestId: string } | Failure;
    try {
      result = await withTenantDb(g.slug, async (db, t) =>
        db.transaction(async (tx) => {
          const [quote] = await tx
            .select({ requestId: t.quotes.requestId, status: t.quotes.status })
            .from(t.quotes)
            .where(eq(t.quotes.id, quoteId))
            .limit(1);
          if (!quote) return fail(g.te("requests.badState"));
          const [req] = await tx
            .select({ status: t.bookingRequests.status, staffId: t.bookingRequests.staffId })
            .from(t.bookingRequests)
            .where(eq(t.bookingRequests.id, quote.requestId))
            .for("update");
          if (!req) return fail(g.te("requests.badState"));
          if (!canTouch(g, req.staffId)) return fail(g.te("requests.notAllowed"));
          if (quote.status !== "draft" || !canTransitionRequest(req.status as RequestStatus, "quoted")) {
            return fail(g.te("requests.badState"));
          }
          const [{ minutes }] = await tx
            .select({ minutes: sql<number>`coalesce(sum(${t.quoteLineItems.minutes}), 0)::int` })
            .from(t.quoteLineItems)
            .where(eq(t.quoteLineItems.quoteId, quoteId));
          if (minutes < 5 || minutes > 1440) return fail(g.te("requests.needsTime"));

          await tx
            .update(t.quotes)
            .set({
              status: "sent",
              sentAt: sql`now()`,
              validUntil: sql`now() + make_interval(days => ${validDays})`,
              updatedAt: sql`now()`,
            })
            .where(eq(t.quotes.id, quoteId));
          await tx
            .update(t.bookingRequests)
            .set({ status: "quoted", updatedAt: sql`now()` })
            .where(eq(t.bookingRequests.id, quote.requestId));
          return { success: true as const, requestId: quote.requestId };
        }),
      );
    } catch (err) {
    if (err instanceof AuthError) throw err;
      // Two sent quotes for one request can only collide on the unique index.
      if (pgErrorInfo(err).code === "23505") return fail(g.te("requests.badState"));
      throw err;
    }
    if (!result.success) return result;
    await deliverQuote(g.slug, quoteId).catch((err) => console.error("[requests] deliver failed:", err));
    revalidatePath(`/requests/${result.requestId}`);
    revalidatePath("/requests");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function withdrawQuote(quoteId: string): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    const result = await withTenantDb(g.slug, async (db, t) =>
      db.transaction(async (tx) => {
        const [quote] = await tx
          .select({ requestId: t.quotes.requestId })
          .from(t.quotes)
          .where(eq(t.quotes.id, quoteId))
          .limit(1);
        if (!quote) return fail(g.te("requests.badState"));
        const [req] = await tx
          .select({ status: t.bookingRequests.status, staffId: t.bookingRequests.staffId })
          .from(t.bookingRequests)
          .where(eq(t.bookingRequests.id, quote.requestId))
          .for("update");
        if (!req) return fail(g.te("requests.badState"));
        if (!canTouch(g, req.staffId)) return fail(g.te("requests.notAllowed"));
        const withdrawn = await tx
          .update(t.quotes)
          .set({ status: "withdrawn", updatedAt: sql`now()` })
          .where(and(eq(t.quotes.id, quoteId), eq(t.quotes.status, "sent")))
          .returning({ id: t.quotes.id });
        if (withdrawn.length === 0) return fail(g.te("requests.badState"));
        if (req.status === "quoted") {
          await tx
            .update(t.bookingRequests)
            .set({ status: "reviewing", updatedAt: sql`now()` })
            .where(eq(t.bookingRequests.id, quote.requestId));
        }
        return { success: true as const, requestId: quote.requestId };
      }),
    );
    if (!result.success) return result;
    revalidatePath(`/requests/${result.requestId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function declineRequest(
  id: string,
  reason?: string,
): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    const result = await withTenantDb(g.slug, async (db, t) =>
      db.transaction(async (tx) => {
        const [req] = await tx
          .select({ status: t.bookingRequests.status, staffId: t.bookingRequests.staffId })
          .from(t.bookingRequests)
          .where(eq(t.bookingRequests.id, id))
          .for("update");
        if (!req) return fail(g.te("requests.badState"));
        if (!canTouch(g, req.staffId)) return fail(g.te("requests.notAllowed"));
        if (!canTransitionRequest(req.status as RequestStatus, "declined")) return fail(g.te("requests.badState"));
        await tx
          .update(t.quotes)
          .set({ status: "withdrawn", updatedAt: sql`now()` })
          .where(and(eq(t.quotes.requestId, id), eq(t.quotes.status, "sent")));
        await tx
          .update(t.bookingRequests)
          .set({
            status: "declined",
            declineReason: reason?.trim().slice(0, 500) || null,
            updatedAt: sql`now()`,
          })
          .where(eq(t.bookingRequests.id, id));
        return { success: true as const };
      }),
    );
    if (result.success) {
      revalidatePath(`/requests/${id}`);
      revalidatePath("/requests");
    }
    return result;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function deleteQuoteDraft(quoteId: string): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    return await withTenantDb(g.slug, async (db, t) => {
      const [row] = await db
        .select({ staffId: t.bookingRequests.staffId, requestId: t.quotes.requestId })
        .from(t.quotes)
        .innerJoin(t.bookingRequests, eq(t.bookingRequests.id, t.quotes.requestId))
        .where(eq(t.quotes.id, quoteId))
        .limit(1);
      if (!row) return fail(g.te("requests.badState"));
      if (!canTouch(g, row.staffId)) return fail(g.te("requests.notAllowed"));
      const removed = await db
        .delete(t.quotes)
        .where(and(eq(t.quotes.id, quoteId), eq(t.quotes.status, "draft")))
        .returning({ id: t.quotes.id });
      if (removed.length === 0) return fail(g.te("requests.badState"));
      revalidatePath(`/requests/${row.requestId}`);
      return { success: true as const };
    });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}
