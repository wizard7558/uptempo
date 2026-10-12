// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "./db-fixtures";

vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: async () => undefined,
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;

// Wednesday 17 June 2026, 10:00 EDT. Rules start here and "now" is the start, so the
// 84-day horizon holds visits 0 to 12 (12 weeks later is exactly 84 days).
const START = new Date("2026-06-17T14:00:00Z");
const NOW = START;

let t: ScratchTenant;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const q1 = async (sqlText: string) => String((await t.run(sqlText))[0].id);

afterAll(async () => {
  if (t) await t.drop();
});

/** A staff member who works Wednesdays, so each test has a calendar of its own. */
async function newStaff(name: string) {
  const id = await q1(`insert into ${s()}.staff (display_name) values ('${name}') returning id`);
  await t.run(
    `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${id}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
  );
  return id;
}

async function newRule(staffId: string, opts: { count?: number | null; rrule?: string } = {}) {
  return q1(
    `insert into ${s()}.recurrence_rules (rrule, starts_at, count, timezone, staff_id, client_id, service_ids)
     values ('${opts.rrule ?? "FREQ=WEEKLY;INTERVAL=1"}', '${START.toISOString()}', ${opts.count ?? "null"}, 'America/New_York',
             '${staffId}', '${ids.client}', '["${ids.service}"]'::jsonb) returning id`,
  );
}

const countVisits = async (ruleId: string) =>
  Number((await t.run(`select count(*)::int as n from ${s()}.appointments where recurrence_rule_id = '${ruleId}'`))[0].n);

describe("recurring bookings against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("./db-fixtures");
    t = await scratchTenant("recur");
    await t.run(`insert into ${s()}.business_settings (timezone) select 'America/New_York' where not exists (select 1 from ${s()}.business_settings)`);
    await t.run(`update ${s()}.business_settings set timezone = 'America/New_York'`);
    ids.l1 = await q1(`select id from ${s()}.locations order by created_at limit 1`);
    ids.client = await q1(`insert into ${s()}.clients (name) values ('Casey') returning id`);
    ids.service = await q1(
      `insert into ${s()}.services (name, default_duration_minutes) values ('Cut', 60) returning id`,
    );
  }, 180_000);

  itDb(
    "a weekly rule with no end books 13 visits and a second run books none",
    async () => {
      const { materializeRule } = await import("./recurrence");
      const staffId = await newStaff("Sam");
      const ruleId = await newRule(staffId);
      const first = await materializeRule(t.slug, ruleId, NOW);
      expect(first).toMatchObject({ skipped: false });
      expect(await countVisits(ruleId)).toBe(13);
      const again = await materializeRule(t.slug, ruleId, NOW);
      expect(again).toMatchObject({ skipped: false, created: [], conflicts: [] });
      expect(await countVisits(ruleId)).toBe(13);
      const rule = (await t.run(`select is_active from ${s()}.recurrence_rules where id = '${ruleId}'`))[0];
      expect(rule.is_active).toBe(1);
      // Every visit keeps its 10:00 local start (14:00 UTC in EDT, 15:00 UTC after 1 Nov).
      const odd = await t.run(
        `select 1 from ${s()}.appointments where recurrence_rule_id = '${ruleId}' and to_char(lower(during) at time zone 'America/New_York', 'HH24:MI') <> '10:00'`,
      );
      expect(odd).toHaveLength(0);
    },
    120_000,
  );

  itDb(
    "a blocked week 3 raises one alert with its dedupe key, and a re-run adds nothing",
    async () => {
      const { materializeRule } = await import("./recurrence");
      const staffId = await newStaff("Robin");
      const ruleId = await newRule(staffId);
      // Visit index 2 is 1 July, 10:00 to 11:00 EDT.
      await t.run(
        `insert into ${s()}.time_blocks (staff_id, location_id, during) values ('${staffId}','${ids.l1}', tstzrange('2026-07-01T14:00:00Z','2026-07-01T15:00:00Z','[)'))`,
      );
      const run = await materializeRule(t.slug, ruleId, NOW);
      expect(run).toMatchObject({ skipped: false });
      if (run.skipped) throw new Error("skipped");
      expect(run.conflicts.map((c) => c.index)).toEqual([2]);
      expect(await countVisits(ruleId)).toBe(12);

      const key = `recurrence_conflict:${ruleId}:2`;
      const alerts = () => t.run(`select * from ${s()}.alerts where dedupe_key like 'recurrence_conflict:${ruleId}:%'`);
      const rows = await alerts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "recurrence_conflict", severity: "warning", dedupe_key: key });
      expect(String(rows[0].body)).toContain("Casey");
      expect(String(rows[0].body)).toContain("that time is blocked off");

      // Forget how far it got: the visits already booked are skipped and the
      // blocked one is reported again, but its alert is not duplicated.
      await t.run(`update ${s()}.recurrence_rules set materialized_through = null where id = '${ruleId}'`);
      await materializeRule(t.slug, ruleId, NOW);
      expect(await alerts()).toHaveLength(1);
      expect(await countVisits(ruleId)).toBe(12);
    },
    120_000,
  );

  itDb(
    "count = 4 books 4 visits and turns the rule off",
    async () => {
      const { materializeRule, materializeTenant } = await import("./recurrence");
      const staffId = await newStaff("Alex");
      const ruleId = await newRule(staffId, { count: 4, rrule: "FREQ=WEEKLY;INTERVAL=1" });
      await materializeRule(t.slug, ruleId, NOW);
      expect(await countVisits(ruleId)).toBe(4);
      const rule = (await t.run(`select is_active from ${s()}.recurrence_rules where id = '${ruleId}'`))[0];
      expect(rule.is_active).toBe(0);
      // An inactive rule is never picked up again.
      const result = await materializeTenant(t.slug, NOW);
      expect(result.created).toBe(0);
      expect(await countVisits(ruleId)).toBe(4);
    },
    120_000,
  );
});
