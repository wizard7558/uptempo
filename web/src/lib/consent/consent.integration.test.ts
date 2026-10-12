// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";
import messages from "@/i18n/messages/en.json";

const itDb = process.env.DATABASE_URL ? it : it.skip;
// Each case makes many round trips to a remote database.
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({ slug: "", sessionClientId: null as string | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => state.slug,
  getTenantSlugOrNull: async () => state.slug,
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: state.slug }),
  getActiveStaffRole: async () => null,
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/booking/session-cookie", () => ({
  getBookingSession: async () => state.sessionClientId,
}));
// The scratch tenant is not in the public registry, so the purge cron is pointed at it directly.
vi.mock("@/lib/tenant/registry", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/registry")>()),
  listActiveTenants: async () => [{ slug: state.slug, schemaVersion: 99 }],
}));
// Only the consent_id module is on.
vi.mock("@/lib/tenant/modules", () => ({
  hasModule: async (_slug: string, id: string) => id === "consent_id",
  assertModule: async () => undefined,
  ModuleDisabledError: class extends Error {},
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/booking/confirmations", () => ({ sendBookingConfirmations: async () => undefined }));
vi.mock("@/actions/calendar-sync", () => ({
  isExternalSlotAvailable: async () => ({ available: true }),
}));
vi.mock("@/lib/calendar/sync-tenant", () => ({
  pushBookingToCalendarForTenant: async () => undefined,
}));
vi.mock("@/lib/services/booking-deposits", () => ({
  previewBookingDepositForTenant: async () => ({ enabled: false, totalCents: 0 }),
  chargeBookingDepositForTenant: async () => ({ charged: false }),
}));
vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: async () => undefined,
}));
// Real copy from en.json so the tests assert on the sentences people see.
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== "string") return `${ns}.${key}`;
    return node.replace(/\{(\w+)\}/g, (m, k) => (k in (values ?? {}) ? String(values?.[k]) : m));
  },
}));

let t: ScratchTenant;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const q1 = async (sqlText: string) => String((await t.run(sqlText))[0].id);

/** 14:00 UTC (10:00 EDT / 09:00 EST) on the UTC day `n` days from now. */
const slotStart = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
};

const newClient = (name: string) => q1(`insert into ${s()}.clients (name) values ('${name}') returning id`);
const birthdayOf = async (id: string) =>
  (await t.run(`select birthday::text as b from ${s()}.clients where id = '${id}'`))[0].b;
const apptCount = async (clientId: string) =>
  Number((await t.run(`select count(*)::int as n from ${s()}.appointments where client_id = '${clientId}'`))[0].n);

let storageDir = "";

afterAll(async () => {
  vi.unstubAllEnvs();
  if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true });
  if (t) await t.drop();
});

describe("consent age gate against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "consent-files-"));
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", storageDir);
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("consent");
    state.slug = t.slug;
    ids.l1 = await q1(`select id from ${s()}.locations order by created_at limit 1`);
    ids.staff = await q1(`insert into ${s()}.staff (display_name) values ('Riley') returning id`);
    for (let dow = 0; dow <= 6; dow++) {
      await t.run(
        `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.staff}', ${dow}, '09:00', '17:00', 1, '${ids.l1}')`,
      );
    }
    ids.flash = await q1(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Flash', 60, 15000) returning id`,
    );
    await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${ids.staff}', '${ids.flash}')`);
    // An 18+ consent form on Flash, plus an inactive 21+ one that must not count.
    const active = await q1(
      `insert into ${s()}.form_templates (name, kind, min_age) values ('Tattoo consent', 'consent', 18) returning id`,
    );
    const inactive = await q1(
      `insert into ${s()}.form_templates (name, kind, min_age, is_active) values ('Old consent', 'consent', 21, 0) returning id`,
    );
    for (const f of [active, inactive]) {
      await t.run(
        `insert into ${s()}.service_form_assignments (service_id, form_template_id) values ('${ids.flash}', '${f}')`,
      );
    }
    ids.under = await newClient("Under Age");
    ids.adult = await newClient("Grown Up");
    ids.public = await newClient("Public Minor");
    ids.admin = await newClient("Admin Unknown");
  }, 180_000);

  itDb("reports the gate: the largest active minimum age", async () => {
    const { getAgeGate } = await import("@/lib/consent/gate");
    expect(await getAgeGate(t.slug, [ids.flash])).toEqual({ minAge: 18, requiresId: false });
    expect(await getAgeGate(t.slug, [])).toBeNull();
  });

  itDb("a 2010 birthday is underage on 2026-06-17; a 2000 birthday is fine and gets saved", async () => {
    const { enforceAgeGate } = await import("@/lib/consent/gate");
    const start = new Date("2026-06-17T16:00:00Z");
    const base = { serviceIds: [ids.flash], start, strict: true };

    expect(await enforceAgeGate(t.slug, { ...base, clientId: ids.under, dobInput: "2010-01-01" })).toEqual({
      ok: false,
      code: "UNDERAGE",
      minAge: 18,
    });

    expect(await birthdayOf(ids.adult)).toBeNull();
    expect(await enforceAgeGate(t.slug, { ...base, clientId: ids.adult, dobInput: "2000-01-01" })).toEqual({ ok: true });
    expect(await birthdayOf(ids.adult)).toBe("2000-01-01");

    // A birthday on file is not overwritten by a later typed one.
    await enforceAgeGate(t.slug, { ...base, clientId: ids.adult, dobInput: "2015-05-05" });
    expect(await birthdayOf(ids.adult)).toBe("2000-01-01");
  });

  itDb("confirmBooking with an underage birthday fails and writes no appointment", async () => {
    const { confirmBooking } = await import("@/actions/booking-public");
    state.sessionClientId = ids.public;
    const input = {
      salonId: t.slug,
      staffId: ids.staff,
      clientId: ids.public,
      serviceIds: [ids.flash],
      startTime: slotStart(10),
    };

    const missing = await confirmBooking(input);
    expect(missing).toMatchObject({ success: false, code: "DOB_REQUIRED" });
    expect(await apptCount(ids.public)).toBe(0);

    const res = await confirmBooking({ ...input, dob: "2010-01-01" });
    expect(res.success).toBe(false);
    expect("error" in res && res.error).toMatch(/You must be 18 or older/);
    expect(await apptCount(ids.public)).toBe(0);
  });

  itDb("the admin booking path lets an unknown birthday through, but not a known underage one", async () => {
    const { createBooking } = await import("@/actions/appointments");
    const ok = await createBooking({
      staffId: ids.staff,
      clientId: ids.admin,
      serviceIds: [ids.flash],
      startTime: slotStart(10),
    });
    expect(ok.success).toBe(true);
    expect(await apptCount(ids.admin)).toBe(1);

    // The public attempt above saved the typed 2010 birthday, so staff are now stopped too.
    const blocked = await createBooking({
      staffId: ids.staff,
      clientId: ids.public,
      serviceIds: [ids.flash],
      startTime: slotStart(11),
    });
    expect(blocked.success).toBe(false);
    expect(!blocked.success && "error" in blocked && (blocked.error as { code?: string }).code).toBe("UNDERAGE");
    expect(await apptCount(ids.public)).toBe(0);
  });

  itDb("a public booking with an adult birthday goes through and saves it", async () => {
    const { confirmBooking } = await import("@/actions/booking-public");
    const adult = await newClient("Public Adult");
    state.sessionClientId = adult;
    const res = await confirmBooking({
      salonId: t.slug,
      staffId: ids.staff,
      clientId: adult,
      serviceIds: [ids.flash],
      startTime: slotStart(12),
      dob: "1990-03-04",
    });
    expect(res.success).toBe(true);
    expect(await birthdayOf(adult)).toBe("1990-03-04");
    expect(await apptCount(adult)).toBe(1);
  });

  itDb("updateIdRetention changes the setting and moves every live ID photo's delete date", async () => {
    const { updateIdRetention } = await import("@/actions/forms");
    const photo = (key: string, extra = "") =>
      q1(
        `insert into ${s()}.attachments (owner_type, client_id, kind, storage_key, mime, size_bytes, uploaded_by, is_private, delete_after ${extra ? ", deleted_at" : ""})
         values ('form_response', '${ids.adult}', 'id_document', '${key}', 'image/jpeg', 1000, 'client', 1, now() + interval '365 days' ${extra ? ", now()" : ""}) returning id`,
      );
    const live = await photo(`id/${Date.now()}-live.jpg`);
    const gone = await photo(`id/${Date.now()}-gone.jpg`, "deleted");

    expect(await updateIdRetention(45)).toMatchObject({ success: false });

    expect(await updateIdRetention(30)).toEqual({ success: true });
    const [setting] = await t.run(`select id_retention_days from ${s()}.business_settings limit 1`);
    expect(setting.id_retention_days).toBe(30);

    const [row] = await t.run(
      `select delete_after = created_at + interval '30 days' as moved from ${s()}.attachments where id = '${live}'`,
    );
    expect(row.moved).toBe(true);
    // A photo that is already deleted is left alone.
    const [old] = await t.run(
      `select delete_after = created_at + interval '30 days' as moved from ${s()}.attachments where id = '${gone}'`,
    );
    expect(old.moved).toBe(false);
  });

  describe("private ID photos", () => {
    // 8-byte PNG signature plus filler: enough for the sniffer.
    const png = () =>
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], "id.png", {
        type: "image/png",
      });
    const photoForm = () => {
      const f = new FormData();
      f.set("file", png());
      return f;
    };

    let apptDay = 40;
    const makeResponse = async (templateId: string, clientId: string) => {
      apptDay++;
      const appt = await q1(
        `insert into ${s()}.appointments (staff_id, client_id, location_id, status, during)
         values ('${ids.staff}', '${clientId}', '${ids.l1}', 'confirmed',
           tstzrange(now() + interval '${apptDay} days', now() + interval '${apptDay} days 1 hour')) returning id`,
      );
      const id = await q1(
        `insert into ${s()}.form_responses (form_template_id, appointment_id, client_id)
         values ('${templateId}', '${appt}', '${clientId}') returning id`,
      );
      const { createFormToken } = await import("@/lib/email/tokens");
      return { id, appt, token: createFormToken(id, appt) };
    };

    const ctx = {} as { id: string; token: string; template: string; attachmentId: string; key: string };

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) return;
      ctx.template = await q1(
        `insert into ${s()}.form_templates (name, kind, min_age, requires_id) values ('ID consent', 'consent', 18, 1) returning id`,
      );
      const { updateIdRetention } = await import("@/actions/forms");
      await updateIdRetention(365);
      const r = await makeResponse(ctx.template, ids.adult);
      ctx.id = r.id;
      ctx.token = r.token;
    });

    itDb("a requires_id form cannot be submitted without an ID", async () => {
      const { submitFormResponse } = await import("@/actions/forms");
      const res = await submitFormResponse({ formResponseId: ctx.id, token: ctx.token, responses: {}, dob: "2000-01-01" });
      expect(res).toMatchObject({ success: false, error: "Please add a photo of your ID." });
      const [row] = await t.run(`select submitted_at from ${s()}.form_responses where id = '${ctx.id}'`);
      expect(row.submitted_at).toBeNull();
    });

    itDb("rejects an upload with a wrong or mismatched token, and a non-image file", async () => {
      const { uploadIdPhoto } = await import("@/actions/forms");
      expect(await uploadIdPhoto(ctx.id, "garbage.token", photoForm())).toMatchObject({ success: false });
      const other = await makeResponse(ctx.template, ids.adult);
      expect(await uploadIdPhoto(ctx.id, other.token, photoForm())).toMatchObject({ success: false });
      const bad = new FormData();
      bad.set("file", new File([new Uint8Array([1, 2, 3, 4])], "x.png", { type: "image/png" }));
      expect(await uploadIdPhoto(ctx.id, ctx.token, bad)).toMatchObject({ success: false });
      const [row] = await t.run(`select id_attachment_id from ${s()}.form_responses where id = '${ctx.id}'`);
      expect(row.id_attachment_id).toBeNull();
    });

    itDb("uploadIdPhoto stores a private file kept for 365 days and returns only the file name", async () => {
      const { uploadIdPhoto } = await import("@/actions/forms");
      const res = await uploadIdPhoto(ctx.id, ctx.token, photoForm());
      expect(res).toEqual({ success: true, fileName: "id.png" });

      const [row] = await t.run(
        `select a.id, a.storage_key, a.kind, a.is_private, a.owner_type,
                extract(epoch from (a.delete_after - now())) as secs
           from ${s()}.form_responses r join ${s()}.attachments a on a.id = r.id_attachment_id
          where r.id = '${ctx.id}'`,
      );
      expect(row).toMatchObject({ kind: "id_document", is_private: 1, owner_type: "form_response" });
      expect(Math.abs(Number(row.secs) - 365 * 86_400)).toBeLessThan(60);
      ctx.attachmentId = String(row.id);
      ctx.key = String(row.storage_key);
      expect(fs.existsSync(path.join(storageDir, ctx.key))).toBe(true);

      const [dump] = await t.run(
        `select (select row_to_json(a)::text from ${s()}.attachments a where a.id = '${ctx.attachmentId}') as a,
                (select row_to_json(r)::text from ${s()}.form_responses r where r.id = '${ctx.id}') as r`,
      );
      expect(String(dump.a)).not.toContain("http");
      expect(String(dump.r)).not.toContain("http");
    });

    itDb("with an ID attached the form submits", async () => {
      const { submitFormResponse } = await import("@/actions/forms");
      const res = await submitFormResponse({ formResponseId: ctx.id, token: ctx.token, responses: {}, dob: "2000-01-01" });
      expect(res).toEqual({ success: true });
    });

    itDb("staff see the ID status with a signed link, and verifyConsentId records who and when", async () => {
      const { getFormResponsesForClient, verifyConsentId } = await import("@/actions/forms");
      const before = (await getFormResponsesForClient(ids.adult)).find((r) => r.id === ctx.id);
      expect(before?.idCheck).toMatchObject({ hasId: true, deleted: false, retentionDays: 365, verifiedAt: null });
      expect(before?.idCheck?.viewUrl).toContain(`/api/attachments/${t.slug}/${ctx.attachmentId}?e=`);
      expect(before?.idCheck?.viewUrl).not.toContain("http");

      expect(await verifyConsentId(ctx.id)).toEqual({ success: true });
      const [row] = await t.run(`select verified_by, verified_at from ${s()}.form_responses where id = '${ctx.id}'`);
      expect(row.verified_by).toBe("u1");
      expect(row.verified_at).not.toBeNull();

      // A response with no ID cannot be marked checked.
      const none = await makeResponse(ctx.template, ids.adult);
      expect(await verifyConsentId(none.id)).toMatchObject({ success: false });
    });

    itDb("the purge cron deletes an expired file and marks it deleted; the file route then 404s", async () => {
      await t.run(`update ${s()}.attachments set delete_after = now() - interval '1 hour' where id = '${ctx.attachmentId}'`);
      const { signFileLink } = await import("@/lib/storage/file-links");
      const route = await import("@/app/api/attachments/[slug]/[id]/route");
      const fileRoute = async () => {
        const link = signFileLink(t.slug, ctx.attachmentId, 300);
        return route.GET(new Request(`http://localhost${link}`), {
          params: Promise.resolve({ slug: t.slug, id: ctx.attachmentId }),
        });
      };
      // Before the purge the link is good for staff only; without a staff session it is refused.
      expect((await fileRoute()).status).toBe(403);

      process.env.CRON_SECRET = "cron-test";
      const { GET } = await import("@/app/api/cron/purge-private-files/route");
      const res = await GET(
        new Request("http://localhost/api/cron/purge-private-files", {
          headers: { authorization: "Bearer cron-test" },
        }),
      );
      delete process.env.CRON_SECRET;
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ deleted: 1, failed: 0 });

      expect(fs.existsSync(path.join(storageDir, ctx.key))).toBe(false);
      const [row] = await t.run(`select deleted_at from ${s()}.attachments where id = '${ctx.attachmentId}'`);
      expect(row.deleted_at).not.toBeNull();
      expect((await fileRoute()).status).toBe(404);

      const { getFormResponsesForClient } = await import("@/actions/forms");
      const after = (await getFormResponsesForClient(ids.adult)).find((r) => r.id === ctx.id);
      expect(after?.idCheck).toMatchObject({ deleted: true, viewUrl: null });
    });
  });
});
