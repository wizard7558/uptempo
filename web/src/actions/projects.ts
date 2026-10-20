"use server";

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { getActorStaffId } from "@/lib/auth/actor-staff";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getT } from "@/lib/terms/server";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { AttachmentError, createAttachment } from "@/lib/attachments/service";
import { signFileLink } from "@/lib/storage/file-links";
import { computeProjectBalance, type ProjectBalance, type ProjectCharge } from "@/lib/projects/balance";
import { canEditProject } from "@/lib/projects/access";
import { loadProjectCharges } from "@/lib/projects/ledger";
import { absoluteProjectUrl, deliverDesign } from "@/lib/projects/deliver";
import { attributeFilterFor, listDefinitions } from "@/lib/custom-fields/service";

export type ProjectFilter = "active" | "complete" | "all";

const PROJECT_STATUSES = [
  "consult",
  "design",
  "scheduled",
  "in_progress",
  "healing",
  "touch_up",
  "complete",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectRow = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  staffId: string | null;
  staffName: string | null;
  status: ProjectStatus;
  estSessions: number;
  /** Completed appointments in the project. */
  doneSessions: number;
  quotedTotalCents: number | null;
  /** Quoted total minus what has been paid; null when there is no quoted total. */
  leftToPayCents: number | null;
  designApproved: boolean;
  updatedAt: Date;
};

export type ProjectAppointment = {
  id: string;
  start: Date;
  end: Date;
  status: string;
  serviceNames: string[];
  /** Completed service payment for this appointment, tip excluded. */
  paidCents: number;
};

export type ProjectDetail = {
  project: {
    id: string;
    clientId: string;
    staffId: string | null;
    title: string;
    placement: string | null;
    size: string | null;
    status: ProjectStatus;
    estSessions: number;
    quotedTotalCents: number | null;
    notes: string | null;
    createdAt: Date;
    attributes: Record<string, unknown>;
  };
  client: { id: string; name: string; phone: string | null; email: string | null };
  appointments: ProjectAppointment[];
  ledger: ProjectBalance;
  design: {
    /** Signed link to the image (5 minutes); null when no design is uploaded. */
    viewUrl: string | null;
    sentAt: Date | null;
    approvedAt: Date | null;
    approvedName: string | null;
  };
  /** The public approval link. */
  link: string;
};

type Failure = { success: false; error: string };
const fail = (error: string): Failure => ({ success: false, error });

/** Staff session + module gate. Providers may only edit their own projects (`canEditProject`). */
async function guard() {
  const auth = await requireRole("owner", "admin", "provider");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  await assertModule(slug, "projects");
  const actorStaffId = auth.role === "provider" ? await getActorStaffId(slug, auth.userId) : null;
  const te = await getT("projects", slug);
  /** Looks up `projects.errors.<key>`. */
  const err = (key: string) => te(`errors.${key}`);
  return { slug, role: auth.role, userId: auth.userId, actorStaffId, err };
}
type Guard = Awaited<ReturnType<typeof guard>>;

const mayEdit = (g: Guard, projectStaffId: string | null) =>
  canEditProject(g.role, g.actorStaffId, projectStaffId);

/** Turns a thrown module-off error into the sentence the owner should see. */
function asFailure(err: unknown): Failure {
  if (err instanceof ModuleDisabledError) return fail(err.message);
  throw err;
}

const fieldsSchema = {
  staffId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  placement: z.string().trim().max(200).nullable().optional(),
  size: z.string().trim().max(200).nullable().optional(),
  estSessions: z.number().int().min(1).max(50),
  quotedTotalCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
};

const createSchema = z.object({ clientId: z.uuid(), ...fieldsSchema });
export type CreateProjectInput = z.input<typeof createSchema>;

const updateSchema = z.object({
  id: z.uuid(),
  ...fieldsSchema,
  status: z.enum(PROJECT_STATUSES),
});
export type UpdateProjectInput = z.input<typeof updateSchema>;

const blankToNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function revalidateProject(id?: string) {
  revalidatePath("/projects");
  if (id) revalidatePath(`/projects/${id}`);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProjects(
  filter: ProjectFilter = "active",
  attributeFilter?: { key: string; value: string },
): Promise<ProjectRow[]> {
  await requireStaff();
  const g = await guard();
  const defs = attributeFilter ? await listDefinitions(g.slug, "project") : [];
  return withTenantDb(g.slug, async (db, t) => {
    const statusWhere =
      filter === "active"
        ? notInArray(t.projects.status, ["complete", "cancelled"])
        : filter === "complete"
          ? eq(t.projects.status, "complete")
          : undefined;
    const where = and(statusWhere, attributeFilterFor(defs, t.projects.attributes, attributeFilter));
    const rows = await db
      .select({
        id: t.projects.id,
        clientId: t.projects.clientId,
        clientName: t.clients.name,
        title: t.projects.title,
        staffId: t.projects.staffId,
        staffName: t.staff.displayName,
        status: t.projects.status,
        estSessions: t.projects.estSessions,
        quotedTotalCents: t.projects.quotedTotalCents,
        designApprovedAt: t.projects.designApprovedAt,
        updatedAt: t.projects.updatedAt,
      })
      .from(t.projects)
      .innerJoin(t.clients, eq(t.clients.id, t.projects.clientId))
      .leftJoin(t.staff, eq(t.staff.id, t.projects.staffId))
      .where(where)
      .orderBy(desc(t.projects.updatedAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const done = await db
      .select({ projectId: t.appointments.projectId, n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(and(inArray(t.appointments.projectId, ids), eq(t.appointments.status, "completed")))
      .groupBy(t.appointments.projectId);
    const doneBy = new Map(done.map((d) => [d.projectId, d.n]));

    const chargeRows = await db
      .select({
        projectId: t.appointments.projectId,
        reason: t.charges.reason,
        status: t.charges.status,
        amountCents: t.charges.amountCents,
        tipCents: t.charges.tipCents,
        depositAppliedCents: t.charges.depositAppliedCents,
      })
      .from(t.charges)
      .innerJoin(t.appointments, eq(t.charges.appointmentId, t.appointments.id))
      .where(inArray(t.appointments.projectId, ids));
    const chargesBy = new Map<string, ProjectCharge[]>();
    for (const c of chargeRows) {
      if (!c.projectId) continue;
      const list = chargesBy.get(c.projectId) ?? [];
      list.push(c);
      chargesBy.set(c.projectId, list);
    }

    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      title: r.title,
      staffId: r.staffId,
      staffName: r.staffName,
      status: r.status as ProjectStatus,
      estSessions: r.estSessions,
      doneSessions: doneBy.get(r.id) ?? 0,
      quotedTotalCents: r.quotedTotalCents,
      leftToPayCents: computeProjectBalance(r.quotedTotalCents, chargesBy.get(r.id) ?? []).balanceCents,
      designApproved: r.designApprovedAt != null,
      updatedAt: r.updatedAt,
    }));
  });
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  await requireStaff();
  const g = await guard();
  if (!z.uuid().safeParse(id).success) return null;
  const data = await withTenantDb(g.slug, async (db, t) => {
    const [row] = await db
      .select({
        project: t.projects,
        clientName: t.clients.name,
        clientPhone: t.clients.phone,
        clientEmail: t.clients.email,
      })
      .from(t.projects)
      .innerJoin(t.clients, eq(t.clients.id, t.projects.clientId))
      .where(eq(t.projects.id, id))
      .limit(1);
    if (!row) return null;

    const appts = await db
      .select({
        id: t.appointments.id,
        during: t.appointments.during,
        status: t.appointments.status,
      })
      .from(t.appointments)
      .where(eq(t.appointments.projectId, id))
      .orderBy(asc(sql`lower(${t.appointments.during})`));
    const apptIds = appts.map((a) => a.id);
    const names = apptIds.length
      ? await db
          .select({ appointmentId: t.appointmentServices.appointmentId, name: t.services.name })
          .from(t.appointmentServices)
          .innerJoin(t.services, eq(t.services.id, t.appointmentServices.serviceId))
          .where(inArray(t.appointmentServices.appointmentId, apptIds))
      : [];
    const paid = apptIds.length
      ? await db
          .select({
            appointmentId: t.charges.appointmentId,
            amountCents: t.charges.amountCents,
            tipCents: t.charges.tipCents,
          })
          .from(t.charges)
          .where(
            and(
              inArray(t.charges.appointmentId, apptIds),
              eq(t.charges.reason, "service_payment"),
              eq(t.charges.status, "completed"),
            ),
          )
      : [];
    const charges = await loadProjectCharges(db, t, id);
    return { row, appts, names, paid, charges };
  });
  if (!data) return null;
  const { row, appts, names, paid, charges } = data;
  const p = row.project;
  return {
    project: {
      id: p.id,
      clientId: p.clientId,
      staffId: p.staffId,
      title: p.title,
      placement: p.placement,
      size: p.size,
      status: p.status as ProjectStatus,
      estSessions: p.estSessions,
      quotedTotalCents: p.quotedTotalCents,
      notes: p.notes,
      createdAt: p.createdAt,
      attributes: p.attributes ?? {},
    },
    client: { id: p.clientId, name: row.clientName, phone: row.clientPhone, email: row.clientEmail },
    appointments: appts.map((a) => ({
      id: a.id,
      start: a.during.start,
      end: a.during.end,
      status: a.status,
      serviceNames: names.filter((n) => n.appointmentId === a.id).map((n) => n.name),
      paidCents: paid
        .filter((c) => c.appointmentId === a.id)
        .reduce((sum, c) => sum + c.amountCents - (c.tipCents ?? 0), 0),
    })),
    ledger: computeProjectBalance(p.quotedTotalCents, charges),
    design: {
      viewUrl: p.designAttachmentId ? signFileLink(g.slug, p.designAttachmentId) : null,
      sentAt: p.designSentAt,
      approvedAt: p.designApprovedAt,
      approvedName: p.designApprovedName,
    },
    link: absoluteProjectUrl(g.slug, p.accessToken),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createProject(
  input: CreateProjectInput,
): Promise<{ success: true; id: string } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(g.err("invalid"));
    const d = parsed.data;
    // A provider's projects are their own; an owner or admin may pick anyone.
    let staffId = d.staffId ?? null;
    if (g.role === "provider") {
      if (!g.actorStaffId || (staffId && staffId !== g.actorStaffId)) return fail(g.err("notAllowed"));
      staffId = g.actorStaffId;
    }

    const result = await withTenantDb(g.slug, async (db, t) => {
      const [client] = await db.select({ id: t.clients.id }).from(t.clients).where(eq(t.clients.id, d.clientId)).limit(1);
      if (!client) return fail(g.err("invalid"));
      if (staffId) {
        const [member] = await db.select({ id: t.staff.id }).from(t.staff).where(eq(t.staff.id, staffId)).limit(1);
        if (!member) return fail(g.err("invalid"));
      }
      const [created] = await db
        .insert(t.projects)
        .values({
          clientId: d.clientId,
          staffId,
          title: d.title,
          placement: blankToNull(d.placement),
          size: blankToNull(d.size),
          estSessions: d.estSessions,
          quotedTotalCents: d.quotedTotalCents ?? null,
          notes: blankToNull(d.notes),
          accessToken: randomBytes(24).toString("base64url"),
        })
        .returning({ id: t.projects.id });
      return { success: true as const, id: created.id };
    });
    if (result.success) revalidateProject(result.id);
    return result;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function updateProject(input: UpdateProjectInput): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fail(g.err("invalid"));
    const d = parsed.data;

    const result = await withTenantDb(g.slug, async (db, t) => {
      const [existing] = await db
        .select({ staffId: t.projects.staffId })
        .from(t.projects)
        .where(eq(t.projects.id, d.id))
        .limit(1);
      if (!existing) return fail(g.err("notFound"));
      if (!mayEdit(g, existing.staffId)) return fail(g.err("notAllowed"));
      // A provider can't hand their project to someone else.
      let staffId = d.staffId === undefined ? existing.staffId : d.staffId;
      if (g.role === "provider" && staffId !== existing.staffId) return fail(g.err("notAllowed"));
      if (staffId) {
        const [member] = await db.select({ id: t.staff.id }).from(t.staff).where(eq(t.staff.id, staffId)).limit(1);
        if (!member) return fail(g.err("invalid"));
      } else {
        staffId = null;
      }
      await db
        .update(t.projects)
        .set({
          staffId,
          title: d.title,
          placement: blankToNull(d.placement),
          size: blankToNull(d.size),
          estSessions: d.estSessions,
          quotedTotalCents: d.quotedTotalCents ?? null,
          notes: blankToNull(d.notes),
          status: d.status,
          updatedAt: sql`now()`,
        })
        .where(eq(t.projects.id, d.id));
      return { success: true as const };
    });
    if (result.success) revalidateProject(d.id);
    return result;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

/** Puts an appointment into a project (or takes it out with `null`). The client must match. */
export async function linkAppointmentToProject(
  appointmentId: string,
  projectId: string | null,
): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    if (!z.uuid().safeParse(appointmentId).success) return fail(g.err("invalid"));
    if (projectId !== null && !z.uuid().safeParse(projectId).success) return fail(g.err("invalid"));

    const result = await withTenantDb(g.slug, async (db, t) => {
      const [appt] = await db
        .select({ clientId: t.appointments.clientId, projectId: t.appointments.projectId })
        .from(t.appointments)
        .where(eq(t.appointments.id, appointmentId))
        .limit(1);
      if (!appt) return fail(g.err("appointmentNotFound"));

      // Every project involved (the one it leaves and the one it joins) must be editable.
      for (const pid of new Set([appt.projectId, projectId].filter((v): v is string => v != null))) {
        const [p] = await db
          .select({ staffId: t.projects.staffId, clientId: t.projects.clientId })
          .from(t.projects)
          .where(eq(t.projects.id, pid))
          .limit(1);
        if (!p) return fail(g.err("notFound"));
        if (!mayEdit(g, p.staffId)) return fail(g.err("notAllowed"));
        if (pid === projectId && p.clientId !== appt.clientId) {
          return fail(g.err("differentClient"));
        }
      }
      await db.update(t.appointments).set({ projectId }).where(eq(t.appointments.id, appointmentId));
      return { success: true as const, from: appt.projectId };
    });
    if (!result.success) return result;
    revalidatePath("/schedule");
    if (result.from) revalidateProject(result.from);
    if (projectId) revalidateProject(projectId);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

/** Stores a design image, clears any earlier approval, and moves a consult into design. */
export async function uploadProjectDesign(
  projectId: string,
  form: FormData,
): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    if (!z.uuid().safeParse(projectId).success) return fail(g.err("invalid"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return fail(g.err("chooseImage"));

    const project = await withTenantDb(g.slug, async (db, t) => {
      const [p] = await db
        .select({ staffId: t.projects.staffId, clientId: t.projects.clientId })
        .from(t.projects)
        .where(eq(t.projects.id, projectId))
        .limit(1);
      return p ?? null;
    });
    if (!project) return fail(g.err("notFound"));
    if (!mayEdit(g, project.staffId)) return fail(g.err("notAllowed"));

    let attachmentId: string;
    try {
      ({ id: attachmentId } = await createAttachment({
        slug: g.slug,
        ownerType: "project",
        ownerId: projectId,
        clientId: project.clientId,
        kind: "design",
        file,
        uploadedBy: g.userId,
        deleteAfter: null,
      }));
    } catch (err) {
    if (err instanceof AuthError) throw err;
      if (err instanceof AttachmentError) {
        return fail(
          g.err(err.code === "ATTACHMENT_TOO_LARGE" ? "tooLarge" : "unsupportedType"),
        );
      }
      throw err;
    }

    await withTenantDb(g.slug, async (db, t) => {
      await db
        .update(t.projects)
        .set({
          designAttachmentId: attachmentId,
          designApprovedAt: null,
          designApprovedName: null,
          status: sql`CASE WHEN ${t.projects.status} = 'consult' THEN 'design' ELSE ${t.projects.status} END`,
          updatedAt: sql`now()`,
        })
        .where(eq(t.projects.id, projectId));
    });
    revalidateProject(projectId);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

/** Marks the design as sent and texts and emails the client the approval link. */
export async function sendDesignForApproval(projectId: string): Promise<{ success: true } | Failure> {
  await requireStaff();
  try {
    const g = await guard();
    if (!z.uuid().safeParse(projectId).success) return fail(g.err("invalid"));

    const row = await withTenantDb(g.slug, async (db, t) => {
      const [r] = await db
        .select({
          staffId: t.projects.staffId,
          designAttachmentId: t.projects.designAttachmentId,
          token: t.projects.accessToken,
          clientId: t.clients.id,
          email: t.clients.email,
          phone: t.clients.phone,
        })
        .from(t.projects)
        .innerJoin(t.clients, eq(t.clients.id, t.projects.clientId))
        .where(eq(t.projects.id, projectId))
        .limit(1);
      return r ?? null;
    });
    if (!row) return fail(g.err("notFound"));
    if (!mayEdit(g, row.staffId)) return fail(g.err("notAllowed"));
    if (!row.designAttachmentId) return fail(g.err("uploadFirst"));
    if (!row.email && !row.phone) return fail(g.err("noContact"));

    await withTenantDb(g.slug, async (db, t) => {
      await db
        .update(t.projects)
        .set({ designSentAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(t.projects.id, projectId));
    });
    await deliverDesign(g.slug, {
      clientId: row.clientId,
      email: row.email,
      phone: row.phone,
      token: row.token,
    });
    revalidateProject(projectId);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Public (no staff session): the client's design page
// ---------------------------------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export type ProjectForClient = {
  title: string;
  businessName: string;
  /** Signed link to the design image (15 minutes); null when there is none. */
  designUrl: string | null;
  approved: boolean;
  /** Quoted total minus paid, in cents; null when the project has no quoted total. */
  balance: number | null;
};

/** What the client's design page shows. Null for a bad link or a business with the module off. */
export async function getProjectForClient(slug: string, token: string): Promise<ProjectForClient | null> {
  if (!SLUG_RE.test(slug) || !TOKEN_RE.test(token)) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || !(await hasModule(slug, "projects"))) return null;
  return withTenantDb(slug, async (db, t) => {
    const [p] = await db
      .select({
        id: t.projects.id,
        title: t.projects.title,
        quotedTotalCents: t.projects.quotedTotalCents,
        designAttachmentId: t.projects.designAttachmentId,
        designApprovedAt: t.projects.designApprovedAt,
      })
      .from(t.projects)
      .where(eq(t.projects.accessToken, token))
      .limit(1);
    if (!p) return null;
    const ledger = computeProjectBalance(p.quotedTotalCents, await loadProjectCharges(db, t, p.id));
    return {
      title: p.title,
      businessName: tenant.name,
      designUrl: p.designAttachmentId ? signFileLink(slug, p.designAttachmentId, 900) : null,
      approved: p.designApprovedAt != null,
      balance: ledger.balanceCents,
    };
  });
}

const approveSchema = z.object({
  slug: z.string().regex(SLUG_RE),
  token: z.string().regex(TOKEN_RE),
  name: z.string().trim().min(2).max(120),
});

/** The client types their name to approve the design. Approving twice is refused. */
export async function approveDesign(input: {
  slug: string;
  token: string;
  name: string;
}): Promise<{ success: true } | Failure> {
  const parsed = approveSchema.safeParse(input);
  const te = await getT("projects", SLUG_RE.test(input.slug) ? input.slug : null);
  if (!parsed.success) return fail(te("errors.typeName"));
  const { slug, token, name } = parsed.data;
  if (!(await getTenantBySlug(slug)) || !(await hasModule(slug, "projects"))) {
    return fail(te("errors.linkUnavailable"));
  }
  const updated = await withTenantDb(slug, async (db, t) =>
    db
      .update(t.projects)
      .set({ designApprovedAt: sql`now()`, designApprovedName: name, updatedAt: sql`now()` })
      .where(
        and(
          eq(t.projects.accessToken, token),
          sql`${t.projects.designAttachmentId} IS NOT NULL`,
          sql`${t.projects.designApprovedAt} IS NULL`,
        ),
      )
      .returning({ id: t.projects.id }),
  );
  if (updated.length === 0) return fail(te("errors.notWaiting"));
  revalidateProject(updated[0].id);
  return { success: true };
}
