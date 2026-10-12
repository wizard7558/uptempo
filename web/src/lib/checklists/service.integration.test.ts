// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const slugs: string[] = [];

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { dropTenantSchema } = await import("@/lib/tenant/provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // The test already dropped it.
    }
  }
});

describe("appointment checklists", () => {
  itDb(
    "copies template steps once, appends a later step, and checks an item on and off",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const { ensureAppointmentChecklist, setChecklistItemDone } = await import("./service");
      const t = await scratchTenant("chk");
      slugs.push(t.slug);
      try {
        const [service] = await t.run(
          `INSERT INTO "${t.schema}".services (name, default_duration_minutes) VALUES ('Cut', 30) RETURNING id`,
        );
        const items = [
          { id: "s1", label: "Clean station" },
          { id: "s2", label: "Stencil approved" },
          { id: "s3", label: "Aftercare explained" },
        ];
        await t.run(
          `INSERT INTO "${t.schema}".checklist_templates (service_id, items)
           VALUES ('${service.id}', '${JSON.stringify(items)}'::jsonb)`,
        );
        const [staff] = await t.run(
          `INSERT INTO "${t.schema}".staff (display_name) VALUES ('Ari') RETURNING id`,
        );
        const [client] = await t.run(
          `INSERT INTO "${t.schema}".clients (name) VALUES ('Pat') RETURNING id`,
        );
        const [appt] = await t.run(
          `INSERT INTO "${t.schema}".appointments (staff_id, client_id, during)
           VALUES ('${staff.id}', '${client.id}', tstzrange(now(), now() + interval '1 hour', '[)'))
           RETURNING id`,
        );
        await t.run(
          `INSERT INTO "${t.schema}".appointment_services (appointment_id, service_id, duration_minutes)
           VALUES ('${appt.id}', '${service.id}', 30)`,
        );

        const labelsOf = async () => {
          const rows = await t.run(
            `SELECT id::text, label FROM "${t.schema}".appointment_checklist_items
             WHERE appointment_id = '${appt.id}'
             ORDER BY sort_order, created_at`,
          );
          return rows.map((row) => ({ id: String(row.id), label: String(row.label) }));
        };

        await ensureAppointmentChecklist(t.slug, String(appt.id));
        const first = await labelsOf();
        expect(first.map((row) => row.label)).toEqual([
          "Clean station",
          "Stencil approved",
          "Aftercare explained",
        ]);

        await ensureAppointmentChecklist(t.slug, String(appt.id));
        const second = await labelsOf();
        expect(second).toEqual(first);

        const withFourth = [
          ...items,
          { id: "s4", label: "Photos taken" },
        ];
        await t.run(
          `UPDATE "${t.schema}".checklist_templates
           SET items = '${JSON.stringify(withFourth)}'::jsonb
           WHERE service_id = '${service.id}'`,
        );
        await ensureAppointmentChecklist(t.slug, String(appt.id));
        const third = await labelsOf();
        expect(third.slice(0, 3)).toEqual(first);
        expect(third.map((row) => row.label)).toEqual([
          "Clean station",
          "Stencil approved",
          "Aftercare explained",
          "Photos taken",
        ]);

        const updated = await setChecklistItemDone(t.slug, first[0].id, true, "user-9");
        expect(updated).toBe(true);
        const [checked] = await t.run(
          `SELECT done_by, (done_at IS NOT NULL) AS done
           FROM "${t.schema}".appointment_checklist_items
           WHERE id = '${first[0].id}'`,
        );
        expect(checked).toMatchObject({ done_by: "user-9", done: true });

        const cleared = await setChecklistItemDone(t.slug, first[0].id, false, "user-9");
        expect(cleared).toBe(true);
        const [open] = await t.run(
          `SELECT done_by, done_at
           FROM "${t.schema}".appointment_checklist_items
           WHERE id = '${first[0].id}'`,
        );
        expect(open).toMatchObject({ done_by: null, done_at: null });
      } finally {
        await t.drop();
      }
    },
    60_000,
  );
});
