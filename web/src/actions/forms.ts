"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { hasModule } from "@/lib/tenant/modules";
import { verifyActionToken } from "@/lib/email/tokens";
import { resolveTenantSlugForAppointment } from "@/lib/tenant/registry";
import { createAttachment, AttachmentError, softDeleteAttachment } from "@/lib/attachments/service";
import { signFileLink } from "@/lib/storage/file-links";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { z } from "zod";
import { getT } from "@/lib/terms/server";
import { ageOn } from "@/lib/consent/age";
import { parseDob } from "@/lib/consent/gate";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { localDay } from "@/lib/scheduling/intervals";
import {
  createFormTemplateSchema,
  updateFormTemplateSchema,
  formSubmissionSchema,
  idRetentionSchema,
} from "@/lib/validators/forms";
import type { FormField } from "@/lib/validators/forms";

/**
 * Create a new form template with optional service assignments.
 */
export async function createFormTemplate(input: unknown) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const { name, description, fields, serviceIds, kind } = parsed.data;
  // Age and ID settings only mean something on a consent form.
  const isConsent = kind === "consent";
  const minAge = isConsent ? (parsed.data.minAge ?? null) : null;
  const requiresId = isConsent ? (parsed.data.requiresId ?? 0) : 0;

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const [template] = await db
        .insert(formTemplates)
        .values({
          name,
          description: description ?? null,
          fields: fields as unknown as Record<string, unknown>,
          kind: kind ?? "intake",
          minAge,
          requiresId,
        })
        .returning({ id: formTemplates.id });

      if (serviceIds && serviceIds.length > 0) {
        await db.insert(serviceFormAssignments).values(
          serviceIds.map((serviceId) => ({
            serviceId,
            formTemplateId: template.id,
          })),
        );
      }

      trackEvent("form.created", { templateId: template.id, serviceCount: serviceIds?.length ?? 0, fieldCount: fields.length }, { tenantSlug: slug });

      revalidatePath("/settings/forms");
      return { success: true as const, id: template.id };
    },
  );
}

/**
 * Update an existing form template and its service assignments.
 */
export async function updateFormTemplate(input: unknown) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const { id, serviceIds, ...updates } = parsed.data;

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.description !== undefined)
        setValues.description = updates.description;
      if (updates.fields !== undefined)
        setValues.fields = updates.fields as unknown as Record<
          string,
          unknown
        >;
      if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
      if (updates.kind !== undefined) setValues.kind = updates.kind;
      if (updates.minAge !== undefined) setValues.minAge = updates.minAge;
      if (updates.requiresId !== undefined) setValues.requiresId = updates.requiresId;
      // Leaving "consent" clears its age and ID settings.
      if (updates.kind !== undefined && updates.kind !== "consent") {
        setValues.minAge = null;
        setValues.requiresId = 0;
      }

      await db
        .update(formTemplates)
        .set(setValues)
        .where(eq(formTemplates.id, id));

      if (serviceIds !== undefined) {
        await db
          .delete(serviceFormAssignments)
          .where(eq(serviceFormAssignments.formTemplateId, id));

        if (serviceIds.length > 0) {
          await db.insert(serviceFormAssignments).values(
            serviceIds.map((serviceId) => ({
              serviceId,
              formTemplateId: id,
            })),
          );
        }
      }

      trackEvent("form.updated", { templateId: id }, { tenantSlug: slug });

      revalidatePath("/settings/forms");
      return { success: true as const };
    },
  );
}

/**
 * List all form templates with their assigned service IDs.
 */
export async function listFormTemplates() {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const templates = await db
        .select()
        .from(formTemplates)
        .orderBy(formTemplates.createdAt);

      const templateIds = templates.map((t) => t.id);
      if (templateIds.length === 0) return [];

      const assignments = await db
        .select({
          formTemplateId: serviceFormAssignments.formTemplateId,
          serviceId: serviceFormAssignments.serviceId,
        })
        .from(serviceFormAssignments)
        .where(inArray(serviceFormAssignments.formTemplateId, templateIds));

      const assignmentMap = new Map<string, string[]>();
      for (const a of assignments) {
        const existing = assignmentMap.get(a.formTemplateId) ?? [];
        existing.push(a.serviceId);
        assignmentMap.set(a.formTemplateId, existing);
      }

      return templates.map((t) => ({
        ...t,
        fields: t.fields as unknown as FormField[],
        serviceIds: assignmentMap.get(t.id) ?? [],
      }));
    },
  );
}

/**
 * Fetch a single form template by ID with its service assignments.
 */
export async function getFormTemplate(id: string) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const [template] = await db
        .select()
        .from(formTemplates)
        .where(eq(formTemplates.id, id))
        .limit(1);

      if (!template) return null;

      const assignments = await db
        .select({ serviceId: serviceFormAssignments.serviceId })
        .from(serviceFormAssignments)
        .where(eq(serviceFormAssignments.formTemplateId, id));

      return {
        ...template,
        fields: template.fields as unknown as FormField[],
        serviceIds: assignments.map((a) => a.serviceId),
      };
    },
  );
}

/**
 * Get active form templates assigned to any of the given service IDs.
 * Deduplicates by template ID (a form assigned to multiple booked services appears once).
 */
export async function getFormsForServices(serviceIds: string[]) {
  if (serviceIds.length === 0) return [];

  const slug = await getTenantSlug();

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const rows = await db
        .select({
          id: formTemplates.id,
          name: formTemplates.name,
          description: formTemplates.description,
          fields: formTemplates.fields,
        })
        .from(serviceFormAssignments)
        .innerJoin(
          formTemplates,
          eq(serviceFormAssignments.formTemplateId, formTemplates.id),
        )
        .where(
          and(
            inArray(serviceFormAssignments.serviceId, serviceIds),
            eq(formTemplates.isActive, 1),
          ),
        );

      // Deduplicate by template ID
      const seen = new Set<string>();
      const unique: typeof rows = [];
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          unique.push(row);
        }
      }

      return unique.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        fields: r.fields as unknown as FormField[],
      }));
    },
  );
}

/**
 * Get all form responses for a specific client, with template info.
 */
export async function getFormResponsesForClient(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { formResponses, formTemplates, attachments }) => {
      const rows = await db
        .select({
          id: formResponses.id,
          formName: formTemplates.name,
          kind: formTemplates.kind,
          submittedAt: formResponses.submittedAt,
          responses: formResponses.responses,
          createdAt: formResponses.createdAt,
          dob: formResponses.dob,
          idAttachmentId: formResponses.idAttachmentId,
          verifiedBy: formResponses.verifiedBy,
          verifiedAt: formResponses.verifiedAt,
          idCreatedAt: attachments.createdAt,
          idDeleteAfter: attachments.deleteAfter,
          idDeletedAt: attachments.deletedAt,
        })
        .from(formResponses)
        .innerJoin(
          formTemplates,
          eq(formResponses.formTemplateId, formTemplates.id),
        )
        .leftJoin(attachments, eq(attachments.id, formResponses.idAttachmentId))
        .where(eq(formResponses.clientId, clientId))
        .orderBy(formResponses.createdAt);

      const verifierIds = [...new Set(rows.map((r) => r.verifiedBy).filter((v): v is string => !!v))];
      const names = new Map<string, string>();
      if (verifierIds.length > 0) {
        const found = await publicDb
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, verifierIds));
        for (const u of found) names.set(u.id, u.name);
      }

      const today = new Date().toISOString().slice(0, 10);
      return rows.map((r) => {
        const isConsent = r.kind === "consent";
        // Staff-only ID details. The link is signed; the file route still demands a staff session.
        const id = isConsent
          ? {
              dob: r.dob,
              age: r.dob ? ageOn(r.dob, today) : null,
              hasId: r.idAttachmentId != null,
              deleted: r.idDeletedAt != null,
              retentionDays:
                r.idCreatedAt && r.idDeleteAfter
                  ? Math.round((r.idDeleteAfter.getTime() - r.idCreatedAt.getTime()) / 86_400_000)
                  : null,
              viewUrl:
                r.idAttachmentId && !r.idDeletedAt ? signFileLink(slug, r.idAttachmentId, 300) : null,
              verifiedAt: r.verifiedAt,
              verifiedByName: r.verifiedBy ? (names.get(r.verifiedBy) ?? null) : null,
            }
          : null;
        return {
          id: r.id,
          formName: r.formName,
          submittedAt: r.submittedAt,
          createdAt: r.createdAt,
          responses: (r.responses ?? {}) as Record<string, unknown>,
          idCheck: id,
        };
      });
    },
  );
}

/**
 * Get form response data for token-based form page.
 * Returns template fields and response status for rendering the public form.
 */
export async function getFormResponseForToken(token: string) {
  const payload = verifyActionToken(token);
  if (!payload || payload.action !== "form" || !payload.formResponseId) return null;
  const slug = await resolveTenantSlugForAppointment(payload.appointmentId);
  if (!slug) return null;
  const formResponseId = payload.formResponseId;

  const consentOn = await hasModule(slug, "consent_id");

  return withTenantDb(
    slug,
    async (db, { formResponses, formTemplates, clients, businessSettings }) => {
      const [row] = await db
        .select({
          id: formResponses.id,
          submittedAt: formResponses.submittedAt,
          formName: formTemplates.name,
          formDescription: formTemplates.description,
          fields: formTemplates.fields,
          kind: formTemplates.kind,
          requiresId: formTemplates.requiresId,
          birthday: clients.birthday,
        })
        .from(formResponses)
        .innerJoin(
          formTemplates,
          eq(formResponses.formTemplateId, formTemplates.id),
        )
        .innerJoin(clients, eq(clients.id, formResponses.clientId))
        .where(eq(formResponses.id, formResponseId))
        .limit(1);

      if (!row) return null;

      if (row.submittedAt) {
        return { alreadySubmitted: true as const };
      }

      let consent: { requiresId: boolean; dob: string | null; idRetentionDays: number } | null = null;
      if (consentOn && row.kind === "consent") {
        const [settings] = await db
          .select({ days: businessSettings.idRetentionDays })
          .from(businessSettings)
          .limit(1);
        consent = {
          requiresId: row.requiresId === 1,
          dob: row.birthday,
          idRetentionDays: settings?.days ?? 365,
        };
      }

      return {
        alreadySubmitted: false as const,
        formName: row.formName,
        formDescription: row.formDescription,
        fields: row.fields as unknown as FormField[],
        /** Set for consent forms: the page asks for a date of birth (prefilled from the client). */
        consent,
      };
    },
  );
}

/**
 * Submit form responses from the public form page.
 * Validates required fields and guards against double submission.
 */
export async function submitFormResponse(input: unknown) {
  const parsed = formSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const { formResponseId, responses, token } = parsed.data;
  const payload = verifyActionToken(token);
  if (!payload || payload.action !== "form" || payload.formResponseId !== formResponseId) {
    return { success: false as const, error: "Form not found" };
  }
  const slug = await resolveTenantSlugForAppointment(payload.appointmentId);
  if (!slug) return { success: false as const, error: "Form not found" };
  const consentOn = await hasModule(slug, "consent_id");

  return withTenantDb(
    slug,
    async (db, { formResponses, formTemplates, appointments, clients }) => {
      // Fetch response record with template fields
      const [record] = await db
        .select({
          id: formResponses.id,
          submittedAt: formResponses.submittedAt,
          formTemplateId: formResponses.formTemplateId,
          appointmentId: formResponses.appointmentId,
          clientId: formResponses.clientId,
          idAttachmentId: formResponses.idAttachmentId,
        })
        .from(formResponses)
        .where(eq(formResponses.id, formResponseId))
        .limit(1);

      if (!record) {
        return { success: false as const, error: "Form not found" };
      }

      if (record.submittedAt) {
        return { success: false as const, error: "Form already submitted" };
      }

      // Fetch template to validate required fields
      const [template] = await db
        .select({
          fields: formTemplates.fields,
          kind: formTemplates.kind,
          minAge: formTemplates.minAge,
          requiresId: formTemplates.requiresId,
        })
        .from(formTemplates)
        .where(eq(formTemplates.id, record.formTemplateId))
        .limit(1);

      if (template) {
        const fields = template.fields as unknown as FormField[];
        for (const field of fields) {
          if (field.required) {
            const value = responses[field.id];
            if (value === undefined || value === null || value === "") {
              return {
                success: false as const,
                error: `Required field "${field.label}" is missing`,
              };
            }
          }
        }
      }

      // Consent forms: a date of birth, checked against the minimum age on the appointment's local day.
      let dob: string | null = null;
      if (consentOn && template?.kind === "consent") {
        const tc = await getT("consent", slug);
        const [client] = await db
          .select({ birthday: clients.birthday })
          .from(clients)
          .where(eq(clients.id, record.clientId))
          .limit(1);
        const typed = parseDob(parsed.data.dob);
        // A birthday already on file wins over what was typed.
        dob = client?.birthday ?? typed;
        if (!dob) {
          return { success: false as const, error: tc("dobRequired") };
        }
        if (template.minAge != null) {
          const [appt] = await db
            .select({ during: appointments.during })
            .from(appointments)
            .where(eq(appointments.id, record.appointmentId))
            .limit(1);
          const start = appt?.during.start ?? new Date();
          const tz = (await loadSchedulingSettings(slug)).timezone;
          if (ageOn(dob, localDay(start, tz)) < template.minAge) {
            return { success: false as const, error: tc("underage", { minAge: template.minAge }) };
          }
        }
        if (template.requiresId === 1 && !record.idAttachmentId) {
          return { success: false as const, error: tc("idRequired") };
        }
        if (client && !client.birthday) {
          await db
            .update(clients)
            .set({ birthday: dob, updatedAt: new Date() })
            .where(and(eq(clients.id, record.clientId), isNull(clients.birthday)));
        }
      }

      await db
        .update(formResponses)
        .set({
          responses: responses as unknown as Record<string, unknown>,
          ...(dob ? { dob } : {}),
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(formResponses.id, formResponseId));

      trackEvent("form.submitted", { formResponseId }, { tenantSlug: slug });

      return { success: true as const };
    },
  );
}

/**
 * Deactivate a form template (soft delete).
 */
export async function deactivateFormTemplate(id: string) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { formTemplates }) => {
    const [result] = await db
      .update(formTemplates)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(formTemplates.id, id))
      .returning({ id: formTemplates.id });

    if (!result) {
      return { success: false as const, error: "Form template not found" };
    }

    trackEvent("form.deleted", { templateId: id }, { tenantSlug: slug });

    revalidatePath("/settings/forms");
    return { success: true as const };
  });
}

/**
 * How long ID photos are kept (owner/admin). Changes the setting and, in the same
 * transaction, the delete date of every ID photo that hasn't been deleted yet.
 */
export async function updateIdRetention(days: number) {
  const parsed = idRetentionSchema.safeParse(days);
  if (!parsed.success) {
    return { success: false as const, error: "Choose one of the listed times." };
  }
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = session.tenantSlug;
  const keepDays = parsed.data;

  await withTenantDb(slug, async (db, { businessSettings, attachments }) =>
    db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: businessSettings.id }).from(businessSettings).limit(1);
      if (existing) {
        await tx
          .update(businessSettings)
          .set({ idRetentionDays: keepDays, updatedAt: new Date() })
          .where(eq(businessSettings.id, existing.id));
      } else {
        await tx.insert(businessSettings).values({ idRetentionDays: keepDays });
      }
      await tx
        .update(attachments)
        .set({ deleteAfter: sql`${attachments.createdAt} + make_interval(days => ${keepDays})` })
        .where(and(eq(attachments.kind, "id_document"), isNull(attachments.deletedAt)));
    }),
  );

  revalidatePath("/settings/forms");
  return { success: true as const };
}

/**
 * Public: a client adds a photo of their ID to a consent form they were sent.
 * The signed form token is checked first. The file is stored privately and only
 * its name goes back to the page, never a URL.
 */
export async function uploadIdPhoto(
  formResponseId: string,
  token: string,
  form: FormData,
): Promise<{ success: true; fileName: string } | { success: false; error: string }> {
  const payload = verifyActionToken(token);
  if (
    !payload ||
    payload.action !== "form" ||
    payload.formResponseId !== formResponseId ||
    !z.uuid().safeParse(formResponseId).success
  ) {
    return { success: false, error: "Upload failed" };
  }
  const slug = await resolveTenantSlugForAppointment(payload.appointmentId);
  if (!slug) return { success: false, error: "Upload failed" };
  const tc = await getT("consent", slug);
  if (!(await hasModule(slug, "consent_id"))) {
    return { success: false, error: tc("uploadFailed") };
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: tc("uploadFailed") };
  }

  const target = await withTenantDb(
    slug,
    async (db, { formResponses, formTemplates, businessSettings }) => {
      const [row] = await db
        .select({
          clientId: formResponses.clientId,
          submittedAt: formResponses.submittedAt,
          kind: formTemplates.kind,
          previous: formResponses.idAttachmentId,
        })
        .from(formResponses)
        .innerJoin(formTemplates, eq(formTemplates.id, formResponses.formTemplateId))
        .where(eq(formResponses.id, formResponseId))
        .limit(1);
      if (!row || row.submittedAt || row.kind !== "consent") return null;
      const [settings] = await db
        .select({ days: businessSettings.idRetentionDays })
        .from(businessSettings)
        .limit(1);
      return { ...row, days: settings?.days ?? 365 };
    },
  );
  if (!target) return { success: false, error: tc("uploadFailed") };

  let attachmentId: string;
  try {
    ({ id: attachmentId } = await createAttachment({
      slug,
      ownerType: "form_response",
      ownerId: formResponseId,
      clientId: target.clientId,
      kind: "id_document",
      file,
      uploadedBy: `client:${target.clientId}`,
      deleteAfter: new Date(Date.now() + target.days * 86_400_000),
    }));
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (!(err instanceof AttachmentError)) console.error("[forms] ID upload failed:", err);
    return { success: false, error: tc("uploadFailed") };
  }

  await withTenantDb(slug, async (db, { formResponses }) => {
    await db
      .update(formResponses)
      .set({ idAttachmentId: attachmentId, updatedAt: new Date() })
      .where(eq(formResponses.id, formResponseId));
  });
  // A replaced photo is removed right away; nobody should keep an ID they no longer need.
  if (target.previous) await softDeleteAttachment(slug, target.previous).catch(() => {});

  return { success: true, fileName: file.name ? file.name.slice(0, 200) : "ID" };
}

/** Staff mark an uploaded ID as checked (owner, admin or provider). */
export async function verifyConsentId(formResponseId: string) {
  const session = await requireRole("owner", "admin", "provider");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = session.tenantSlug;
  if (!z.uuid().safeParse(formResponseId).success) {
    return { success: false as const, error: "Form not found" };
  }
  const updated = await withTenantDb(slug, async (db, { formResponses }) => {
    const rows = await db
      .update(formResponses)
      .set({ verifiedBy: session.userId, verifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(formResponses.id, formResponseId), sql`${formResponses.idAttachmentId} is not null`))
      .returning({ clientId: formResponses.clientId });
    return rows[0] ?? null;
  });
  if (!updated) return { success: false as const, error: "No ID to check" };
  revalidatePath(`/clients/${updated.clientId}`);
  return { success: true as const };
}
