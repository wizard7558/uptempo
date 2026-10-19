// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;
const slugs: string[] = [];

function makeSlug(tag: string): string {
  const slug = `dc60${tag}${randomBytes(6).toString("hex")}`;
  slugs.push(slug);
  return slug;
}

function schemaPath(schema: string): string {
  return `"${schema}"`;
}

async function run(query: string): Promise<Record<string, unknown>[]> {
  const { publicDb } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  let rows: Record<string, unknown>[] = [];
  for (const statement of query.split(";").map((part) => part.trim()).filter(Boolean)) {
    rows = Array.from((await publicDb.execute(sql.raw(statement))) as Iterable<Record<string, unknown>>);
  }
  return rows;
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return undefined;
}

async function expectPgCode(code: string, operation: () => Promise<unknown>) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error, `expected PostgreSQL error ${code}`).toBeDefined();
  expect(pgCode(error)).toBe(code);
}

async function provisionAt59(tag: string): Promise<{ slug: string; schema: string }> {
  const slug = makeSlug(tag);
  const { provisionTenantSchema } = await import("../provision");
  await provisionTenantSchema({ name: `0060 ${tag}`, slug, throughVersion: 59 });
  return { slug, schema: `tenant_${slug}` };
}

async function compatibilityDefinitions(schema: string): Promise<string[]> {
  const rows = await run(`
    SELECT 'view ' || c.relname || ' ' || coalesce(array_to_string(c.reloptions, ','), '')
      || ' ' || replace(pg_get_viewdef(c.oid, true), '${schema}', '<schema>') AS line
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'v'
      AND c.relname IN ('stylists','stylist_services','salon_policies','beauty_bank_transactions','beauty_bank_balances')
    UNION ALL
    SELECT 'trigger ' || c.relname || '.' || t.tgname || ' '
      || replace(pg_get_triggerdef(t.oid, true), '${schema}', '<schema>')
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND NOT t.tgisinternal AND t.tgname = 'domain_compat_sync_0060'
    UNION ALL
    SELECT 'function ' || p.proname || ' ' || replace(pg_get_functiondef(p.oid), '${schema}', '<schema>')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = '${schema}'
      AND p.proname IN (
        'domain_compat_sync_staff_role_0060',
        'domain_compat_sync_staff_id_0060',
        'domain_compat_sync_stored_value_cents_0060'
      )
    ORDER BY line
  `);
  return rows.map((row) => String(row.line));
}

afterAll(async () => {
  if (!DATABASE_URL) return;
  const { dropTenantSchema } = await import("../provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Best-effort cleanup for disposable integration schemas.
    }
  }
  const { closePublicDb } = await import("@/lib/db");
  const { closeShardClients } = await import("@/lib/db/shards");
  await closePublicDb();
  await closeShardClients();
});

describe("migration 0060 forward domain compatibility (PostgreSQL integration)", () => {
  itDb(
    "migrates v59 rows and keeps the v39 views and every writable alias in sync",
    async () => {
      const { slug, schema } = await provisionAt59("surface");
      const q = schemaPath(schema);
      const ids = {
        client: randomUUID(),
        client2: randomUUID(),
        service: randomUUID(),
        location: randomUUID(),
        provider: randomUUID(),
        provider2: randomUUID(),
        provider3: randomUUID(),
        assistant: randomUUID(),
        cascadeStaff: randomUUID(),
        noActionStaff: randomUUID(),
      };

      await run(`
        INSERT INTO ${q}.clients (id, name)
        VALUES ('${ids.client}', 'Compatibility Client'), ('${ids.client2}', 'Second Client');
        INSERT INTO ${q}.services (id, name, default_duration_minutes)
        VALUES ('${ids.service}', 'Compatibility Service', 45);
        INSERT INTO ${q}.locations (id, name)
        VALUES ('${ids.location}', 'Compatibility Location');
        INSERT INTO ${q}.staff (id, display_name, role)
        VALUES
          ('${ids.provider}', 'Provider One', 'provider'),
          ('${ids.provider2}', 'Provider Two', 'provider'),
          ('${ids.provider3}', 'Provider Three', 'provider'),
          ('${ids.assistant}', 'Assistant', 'assistant'),
          ('${ids.cascadeStaff}', 'Cascade Staff', 'provider'),
          ('${ids.noActionStaff}', 'Calendar Staff', 'provider');
        INSERT INTO ${q}.staff_services (staff_id, service_id, price_cents)
        VALUES ('${ids.provider}', '${ids.service}', 5400);
        INSERT INTO ${q}.working_hours (staff_id, day_of_week, start_time, end_time, location_id)
        VALUES ('${ids.provider}', 0, '08:00', '12:00', '${ids.location}');
        INSERT INTO ${q}.appointments (staff_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider}', '${ids.client}', '${ids.service}', '${ids.location}', '[2031-01-01 09:00+00,2031-01-01 10:00+00)');
        INSERT INTO ${q}.time_blocks (staff_id, location_id, during, label)
        VALUES ('${ids.provider}', '${ids.location}', '[2031-01-01 12:00+00,2031-01-01 12:30+00)', 'seed');
        INSERT INTO ${q}.calendar_connections (staff_id, platform, access_token, refresh_token, token_expires_at)
        VALUES ('${ids.provider}', 'seed-calendar', 'access', 'refresh', '2032-01-01T00:00:00Z');
        INSERT INTO ${q}.external_events (connection_id, staff_id, calendar_id, start_time, end_time)
        SELECT id, '${ids.provider}', 'seed-cal', '2031-01-01T13:00:00Z', '2031-01-01T13:30:00Z'
        FROM ${q}.calendar_connections WHERE staff_id = '${ids.provider}' AND platform = 'seed-calendar';
        INSERT INTO ${q}.business_settings (business_address, stored_value_expiry_months)
        VALUES ('1 Canonical Way', 18);
        INSERT INTO ${q}.stored_value_transactions (client_id, type, amount_cents, running_balance_cents)
        VALUES ('${ids.client}', 'admin_credit', 1200, 1200);
        INSERT INTO ${q}.stored_value_balances (client_id, balance_cents)
        VALUES ('${ids.client}', 1200);
        INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason, stored_value_cents)
        SELECT id, '${ids.client}', 5400, 'service_payment', 1200
        FROM ${q}.appointments WHERE staff_id = '${ids.provider}' LIMIT 1;
      `);

      const { migrateTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const up = await migrateTenant(slug, 59);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(60);
      expect(LATEST_SCHEMA_VERSION).toBe(60);

      const viewNames = [
        "beauty_bank_balances",
        "beauty_bank_transactions",
        "salon_policies",
        "stylist_services",
        "stylists",
      ];
      const existingViews = await run(`
        SELECT c.relname AS name, c.relkind, coalesce(array_to_string(c.reloptions, ','), '') AS options
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${schema}' AND c.relname IN (${viewNames.map((n) => `'${n}'`).join(",")})
        ORDER BY c.relname
      `);
      expect(existingViews).toHaveLength(5);
      for (const view of existingViews) {
        expect(view.relkind).toBe("v");
        expect(String(view.options)).toContain("security_invoker=true");
      }

      const expectedViewColumns: Record<string, string[]> = {
        stylists: [
          "id", "user_id", "email", "display_name", "photo_url", "bio", "role", "is_active",
          "created_at", "updated_at", "default_assistant_id", "phone", "target_hours_per_week",
          "target_hourly_earnings_cents",
        ],
        stylist_services: [
          "id", "stylist_id", "service_id", "created_at", "price_cents", "duration_minutes",
          "active_minutes", "processing_minutes", "custom_name", "is_offered", "updated_at",
        ],
        salon_policies: [
          "id", "timezone", "cancellation_window_hours", "cancellation_fee_percent", "no_show_fee_percent",
          "require_card_on_file", "confirmation_enabled", "reminder_enabled", "reminder_hours_before",
          "confirmation_greeting", "confirmation_body", "reminder_greeting", "reminder_body", "salon_address",
          "apple_pay_enabled", "google_pay_enabled", "afterpay_enabled", "cashapp_enabled",
          "sms_reminders_enabled", "sms_reminder_hours_before", "sms_reminder_body", "created_at", "updated_at",
          "sms_confirmation_enabled", "sms_confirmation_body", "sms_aftercare_enabled", "sms_form_requests_enabled",
          "reminder_hours_before_2", "sms_reminder_hours_before_2", "policy_text", "sms_intake_requests_enabled",
          "online_booking_audience", "deposit_enabled", "deposit_default_type", "deposit_default_amount",
          "deposit_duration_threshold_minutes", "beauty_bank_expiry_months", "retail_tax_bps",
          "retail_ship_flat_cents", "monthly_revenue_goal_cents",
        ],
        beauty_bank_transactions: [
          "id", "client_id", "type", "amount_cents", "running_balance_cents", "reference_id",
          "counterparty_client_id", "note", "created_at", "created_by",
        ],
        beauty_bank_balances: ["client_id", "balance_cents", "updated_at"],
      };
      for (const [view, expected] of Object.entries(expectedViewColumns)) {
        const actual = await run(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${schema}' AND table_name = '${view}' ORDER BY ordinal_position
        `);
        expect(actual.map((row) => row.column_name)).toEqual(expected);
        const updatability = await run(`
          SELECT is_updatable, is_insertable_into FROM information_schema.views
          WHERE table_schema = '${schema}' AND table_name = '${view}'
        `);
        expect(updatability[0]).toEqual({ is_updatable: "YES", is_insertable_into: "YES" });
      }

      // Existing canonical rows are readable under old relation and column names.
      expect((await run(`SELECT role FROM ${q}.stylists WHERE id = '${ids.provider}'`))[0].role).toBe("stylist");
      expect((await run(`SELECT role FROM ${q}.stylists WHERE id = '${ids.assistant}'`))[0].role).toBe("assistant");
      expect((await run(`SELECT business_address, stored_value_expiry_months FROM ${q}.business_settings`))[0]).toEqual({
        business_address: "1 Canonical Way",
        stored_value_expiry_months: 18,
      });
      for (const table of ["appointments", "working_hours", "calendar_connections", "external_events", "time_blocks"]) {
        const synced = await run(`SELECT staff_id::text, stylist_id::text FROM ${q}."${table}" LIMIT 1`);
        expect(synced[0]).toEqual({ staff_id: ids.provider, stylist_id: ids.provider });
      }
      expect((await run(`SELECT stored_value_cents, beauty_bank_cents FROM ${q}.charges`))[0]).toEqual({
        stored_value_cents: 1200,
        beauty_bank_cents: 1200,
      });

      // The five simple views support insert, read, update, delete, defaults, and RETURNING.
      const [legacyStylist] = await run(`
        INSERT INTO ${q}.stylists (display_name) VALUES ('Legacy View CRUD')
        RETURNING id::text, role, is_active, created_at, updated_at
      `);
      expect(legacyStylist).toMatchObject({ role: "stylist", is_active: 1 });
      expect(legacyStylist.id).toBeTruthy();
      expect(legacyStylist.created_at).toBeTruthy();
      await run(`UPDATE ${q}.stylists SET role = 'assistant', display_name = 'Legacy View Updated' WHERE id = '${legacyStylist.id}'`);
      expect((await run(`SELECT role FROM ${q}.staff WHERE id = '${legacyStylist.id}'`))[0].role).toBe("assistant");
      await run(`UPDATE ${q}.staff SET role = 'provider' WHERE id = '${legacyStylist.id}'`);
      expect((await run(`SELECT role FROM ${q}.stylists WHERE id = '${legacyStylist.id}'`))[0].role).toBe("stylist");
      await run(`DELETE FROM ${q}.stylists WHERE id = '${legacyStylist.id}'`);

      const [legacyService] = await run(`
        INSERT INTO ${q}.stylist_services (stylist_id, service_id, price_cents)
        VALUES ('${ids.provider2}', '${ids.service}', 6100)
        RETURNING id::text, stylist_id::text, created_at, updated_at
      `);
      expect(legacyService.stylist_id).toBe(ids.provider2);
      expect(legacyService.created_at).toBeTruthy();
      await run(`UPDATE ${q}.stylist_services SET price_cents = 6200 WHERE id = '${legacyService.id}'`);
      expect((await run(`SELECT price_cents FROM ${q}.staff_services WHERE id = '${legacyService.id}'`))[0].price_cents).toBe(6200);
      await run(`DELETE FROM ${q}.stylist_services WHERE id = '${legacyService.id}'`);

      const [legacyPolicy] = await run(`
        INSERT INTO ${q}.salon_policies (timezone, salon_address, beauty_bank_expiry_months)
        VALUES ('UTC', '2 Legacy Street', 24)
        RETURNING id::text, salon_address, beauty_bank_expiry_months, cancellation_window_hours, created_at
      `);
      expect(legacyPolicy).toMatchObject({ salon_address: "2 Legacy Street", beauty_bank_expiry_months: 24, cancellation_window_hours: 24 });
      expect(legacyPolicy.created_at).toBeTruthy();
      await run(`UPDATE ${q}.salon_policies SET salon_address = '3 Legacy Street', beauty_bank_expiry_months = 30 WHERE id = '${legacyPolicy.id}'`);
      expect((await run(`SELECT business_address, stored_value_expiry_months FROM ${q}.business_settings WHERE id = '${legacyPolicy.id}'`))[0]).toEqual({
        business_address: "3 Legacy Street",
        stored_value_expiry_months: 30,
      });
      await run(`DELETE FROM ${q}.salon_policies WHERE id = '${legacyPolicy.id}'`);

      const [legacyTransaction] = await run(`
        INSERT INTO ${q}.beauty_bank_transactions (client_id, type, amount_cents, running_balance_cents)
        VALUES ('${ids.client2}', 'admin_credit', 300, 300)
        RETURNING id::text, client_id::text, created_at
      `);
      expect(legacyTransaction.client_id).toBe(ids.client2);
      expect(legacyTransaction.created_at).toBeTruthy();
      await run(`UPDATE ${q}.beauty_bank_transactions SET note = 'updated' WHERE id = '${legacyTransaction.id}'`);
      expect((await run(`SELECT note FROM ${q}.stored_value_transactions WHERE id = '${legacyTransaction.id}'`))[0].note).toBe("updated");
      await run(`DELETE FROM ${q}.beauty_bank_transactions WHERE id = '${legacyTransaction.id}'`);

      const [legacyBalance] = await run(`
        INSERT INTO ${q}.beauty_bank_balances (client_id, balance_cents)
        VALUES ('${ids.client2}', 450)
        RETURNING client_id::text, balance_cents, updated_at
      `);
      expect(legacyBalance).toMatchObject({ client_id: ids.client2, balance_cents: 450 });
      expect(legacyBalance.updated_at).toBeTruthy();
      await run(`UPDATE ${q}.beauty_bank_balances SET balance_cents = 500 WHERE client_id = '${ids.client2}'`);
      expect((await run(`SELECT balance_cents FROM ${q}.stored_value_balances WHERE client_id = '${ids.client2}'`))[0].balance_cents).toBe(500);
      await run(`DELETE FROM ${q}.beauty_bank_balances WHERE client_id = '${ids.client2}'`);

      // Role defaults are intentionally ambiguous at BEFORE INSERT time: the default is treated as omitted.
      const [defaultRole] = await run(`INSERT INTO ${q}.staff (display_name) VALUES ('Default Role') RETURNING role, legacy_stylist_role`);
      expect(defaultRole).toEqual({ role: "provider", legacy_stylist_role: "stylist" });
      const [canonicalAssistant] = await run(`INSERT INTO ${q}.staff (display_name, role) VALUES ('Canonical Assistant', 'assistant') RETURNING role, legacy_stylist_role`);
      expect(canonicalAssistant).toEqual({ role: "assistant", legacy_stylist_role: "assistant" });
      const [legacyAssistant] = await run(`INSERT INTO ${q}.staff (display_name, legacy_stylist_role) VALUES ('Legacy Assistant', 'assistant') RETURNING role, legacy_stylist_role`);
      expect(legacyAssistant).toEqual({ role: "assistant", legacy_stylist_role: "assistant" });
      const [canonicalStylist] = await run(`INSERT INTO ${q}.staff (display_name, role) VALUES ('Canonical Stylist', 'stylist') RETURNING role, legacy_stylist_role`);
      expect(canonicalStylist).toEqual({ role: "provider", legacy_stylist_role: "stylist" });
      const [legacyStylistRole] = await run(`INSERT INTO ${q}.stylists (display_name, role) VALUES ('Legacy Stylist', 'stylist') RETURNING role`);
      expect(legacyStylistRole.role).toBe("stylist");
      await expectPgCode("23502", () => run(`INSERT INTO ${q}.staff (display_name, role) VALUES ('Null Canonical Role', NULL)`));
      await expectPgCode("23502", () => run(`INSERT INTO ${q}.stylists (display_name, role) VALUES ('Null Legacy Role', NULL)`));
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.staff (display_name, role, legacy_stylist_role) VALUES ('Conflicting Roles', 'manager', 'assistant')`));
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.staff (display_name, role, legacy_stylist_role) VALUES ('Explicit Legacy Provider Conflict', 'assistant', 'provider')`));
      const [dualRole] = await run(`INSERT INTO ${q}.staff (display_name, role, legacy_stylist_role) VALUES ('Dual Role', 'assistant', 'assistant') RETURNING id::text`);
      await expectPgCode("23514", () => run(`UPDATE ${q}.staff SET role = 'provider', legacy_stylist_role = 'manager' WHERE id = '${dualRole.id}'`));
      expect((await run(`SELECT role, legacy_stylist_role FROM ${q}.staff WHERE id = '${dualRole.id}'`))[0]).toEqual({
        role: "assistant",
        legacy_stylist_role: "assistant",
      });

      // Five NOT NULL staff-id pairs accept either name, sync updates both ways, and reject disagreement.
      const [appointmentLegacy] = await run(`
        INSERT INTO ${q}.appointments (stylist_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider}', '${ids.client}', '${ids.service}', '${ids.location}', '[2033-01-01 09:00+00,2033-01-01 10:00+00)')
        RETURNING id::text, staff_id::text, stylist_id::text, status, deposit_cents, created_at
      `);
      expect(appointmentLegacy).toMatchObject({ staff_id: ids.provider, stylist_id: ids.provider, status: "confirmed", deposit_cents: 0 });
      expect(appointmentLegacy.id).toBeTruthy();
      expect(appointmentLegacy.created_at).toBeTruthy();
      await run(`UPDATE ${q}.appointments SET stylist_id = '${ids.provider2}' WHERE id = '${appointmentLegacy.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.appointments WHERE id = '${appointmentLegacy.id}'`))[0]).toEqual({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      await run(`UPDATE ${q}.appointments SET staff_id = '${ids.provider}' WHERE id = '${appointmentLegacy.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.appointments WHERE id = '${appointmentLegacy.id}'`))[0]).toEqual({ staff_id: ids.provider, stylist_id: ids.provider });
      const [appointmentCanonical] = await run(`
        INSERT INTO ${q}.appointments (staff_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider2}', '${ids.client}', '${ids.service}', '${ids.location}', '[2033-01-01 10:00+00,2033-01-01 11:00+00)')
        RETURNING id::text, staff_id::text, stylist_id::text
      `);
      expect(appointmentCanonical).toMatchObject({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.appointments (staff_id, stylist_id, client_id, during) VALUES ('${ids.provider}', '${ids.provider2}', '${ids.client}', '[2033-01-01 12:00+00,2033-01-01 13:00+00)')`));
      await expectPgCode("23502", () => run(`INSERT INTO ${q}.appointments (client_id, during) VALUES ('${ids.client}', '[2033-01-01 13:00+00,2033-01-01 14:00+00)')`));

      const [splitOne] = await run(`
        INSERT INTO ${q}.working_hours (stylist_id, day_of_week, start_time, end_time)
        VALUES ('${ids.provider}', 1, '08:00', '12:00')
        RETURNING id::text, staff_id::text, stylist_id::text, is_enabled, created_at
      `);
      const [splitTwo] = await run(`
        INSERT INTO ${q}.working_hours (staff_id, day_of_week, start_time, end_time)
        VALUES ('${ids.provider}', 1, '13:00', '17:00')
        RETURNING id::text, staff_id::text, stylist_id::text
      `);
      expect(splitOne).toMatchObject({ staff_id: ids.provider, stylist_id: ids.provider, is_enabled: 1 });
      expect(splitOne.created_at).toBeTruthy();
      expect(splitTwo).toMatchObject({ staff_id: ids.provider, stylist_id: ids.provider });
      expect((await run(`SELECT count(*)::int AS count FROM ${q}.working_hours WHERE staff_id = '${ids.provider}' AND day_of_week = 1`))[0].count).toBe(2);
      await run(`UPDATE ${q}.working_hours SET stylist_id = '${ids.provider2}' WHERE id = '${splitOne.id}'`);
      await run(`UPDATE ${q}.working_hours SET staff_id = '${ids.provider}' WHERE id = '${splitOne.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.working_hours WHERE id = '${splitOne.id}'`))[0]).toEqual({ staff_id: ids.provider, stylist_id: ids.provider });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.working_hours (staff_id, stylist_id, day_of_week, start_time, end_time) VALUES ('${ids.provider}', '${ids.provider2}', 2, '08:00', '09:00')`));

      const [connectionLegacy] = await run(`
        INSERT INTO ${q}.calendar_connections (stylist_id, platform, access_token, refresh_token, token_expires_at)
        VALUES ('${ids.provider2}', 'legacy-probe', 'access', 'refresh', '2035-01-01T00:00:00Z')
        RETURNING id::text, staff_id::text, stylist_id::text, status, created_at
      `);
      const [connectionCanonical] = await run(`
        INSERT INTO ${q}.calendar_connections (staff_id, platform, access_token, refresh_token, token_expires_at)
        VALUES ('${ids.provider3}', 'canonical-probe', 'access', 'refresh', '2035-01-01T00:00:00Z')
        RETURNING id::text, staff_id::text, stylist_id::text
      `);
      expect(connectionLegacy).toMatchObject({ staff_id: ids.provider2, stylist_id: ids.provider2, status: "active" });
      expect(connectionLegacy.id).toBeTruthy();
      expect(connectionLegacy.created_at).toBeTruthy();
      expect(connectionCanonical).toMatchObject({ staff_id: ids.provider3, stylist_id: ids.provider3 });
      await run(`UPDATE ${q}.calendar_connections SET stylist_id = '${ids.provider3}' WHERE id = '${connectionLegacy.id}'`);
      await run(`UPDATE ${q}.calendar_connections SET staff_id = '${ids.provider2}' WHERE id = '${connectionLegacy.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.calendar_connections WHERE id = '${connectionLegacy.id}'`))[0]).toEqual({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.calendar_connections (staff_id, stylist_id, platform, access_token, refresh_token, token_expires_at) VALUES ('${ids.provider}', '${ids.provider2}', 'conflict-probe', 'a', 'r', '2035-01-01T00:00:00Z')`));

      const [eventLegacy] = await run(`
        INSERT INTO ${q}.external_events (connection_id, stylist_id, calendar_id, start_time, end_time)
        VALUES ('${connectionLegacy.id}', '${ids.provider2}', 'legacy-calendar', '2035-01-01T01:00:00Z', '2035-01-01T01:30:00Z')
        RETURNING id::text, staff_id::text, stylist_id::text, is_all_day, free_busy_status
      `);
      const [eventCanonical] = await run(`
        INSERT INTO ${q}.external_events (connection_id, staff_id, calendar_id, start_time, end_time)
        VALUES ('${connectionCanonical.id}', '${ids.provider3}', 'canonical-calendar', '2035-01-01T02:00:00Z', '2035-01-01T02:30:00Z')
        RETURNING id::text, staff_id::text, stylist_id::text
      `);
      expect(eventLegacy).toMatchObject({ staff_id: ids.provider2, stylist_id: ids.provider2, is_all_day: 0, free_busy_status: "busy" });
      expect(eventCanonical).toMatchObject({ staff_id: ids.provider3, stylist_id: ids.provider3 });
      await run(`UPDATE ${q}.external_events SET stylist_id = '${ids.provider3}' WHERE id = '${eventLegacy.id}'`);
      await run(`UPDATE ${q}.external_events SET staff_id = '${ids.provider2}' WHERE id = '${eventLegacy.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.external_events WHERE id = '${eventLegacy.id}'`))[0]).toEqual({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.external_events (connection_id, staff_id, stylist_id, calendar_id, start_time, end_time) VALUES ('${connectionLegacy.id}', '${ids.provider}', '${ids.provider2}', 'conflict-calendar', '2035-01-01T03:00:00Z', '2035-01-01T03:30:00Z')`));
      await run(`DELETE FROM ${q}.calendar_connections WHERE id = '${connectionCanonical.id}'`);
      expect((await run(`SELECT count(*)::int AS count FROM ${q}.external_events WHERE id = '${eventCanonical.id}'`))[0].count).toBe(0);

      const [blockLegacy] = await run(`
        INSERT INTO ${q}.time_blocks (stylist_id, location_id, during, label)
        VALUES ('${ids.provider2}', '${ids.location}', '[2036-01-01 08:00+00,2036-01-01 09:00+00)', 'legacy')
        RETURNING id::text, staff_id::text, stylist_id::text, created_at
      `);
      const [blockCanonical] = await run(`
        INSERT INTO ${q}.time_blocks (staff_id, location_id, during, label)
        VALUES ('${ids.provider3}', '${ids.location}', '[2036-01-01 08:00+00,2036-01-01 09:00+00)', 'canonical')
        RETURNING id::text, staff_id::text, stylist_id::text
      `);
      expect(blockLegacy).toMatchObject({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      expect(blockLegacy.created_at).toBeTruthy();
      expect(blockCanonical).toMatchObject({ staff_id: ids.provider3, stylist_id: ids.provider3 });
      await run(`UPDATE ${q}.time_blocks SET stylist_id = '${ids.assistant}' WHERE id = '${blockLegacy.id}'`);
      await run(`UPDATE ${q}.time_blocks SET staff_id = '${ids.provider2}' WHERE id = '${blockLegacy.id}'`);
      expect((await run(`SELECT staff_id::text, stylist_id::text FROM ${q}.time_blocks WHERE id = '${blockLegacy.id}'`))[0]).toEqual({ staff_id: ids.provider2, stylist_id: ids.provider2 });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.time_blocks (staff_id, stylist_id, location_id, during) VALUES ('${ids.provider}', '${ids.provider2}', '${ids.location}', '[2036-01-01 10:00+00,2036-01-01 11:00+00)')`));

      const charges = await run(`
        INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason, beauty_bank_cents)
        VALUES ('${appointmentLegacy.id}', '${ids.client}', 1000, 'service_payment', 250)
        RETURNING id::text, stored_value_cents, beauty_bank_cents, deposit_applied_cents
      `);
      const [legacyCharge] = charges;
      expect(legacyCharge).toEqual({ id: expect.any(String), stored_value_cents: 250, beauty_bank_cents: 250, deposit_applied_cents: 0 });
      const [canonicalCharge] = await run(`
        INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason, stored_value_cents)
        VALUES ('${appointmentCanonical.id}', '${ids.client}', 1000, 'service_payment', 500)
        RETURNING id::text, stored_value_cents, beauty_bank_cents
      `);
      expect(canonicalCharge).toMatchObject({ stored_value_cents: 500, beauty_bank_cents: 500 });
      const [emptyCharge] = await run(`
        INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason)
        VALUES ('${appointmentCanonical.id}', '${ids.client}', 1000, 'service_payment')
        RETURNING stored_value_cents, beauty_bank_cents, deposit_applied_cents
      `);
      expect(emptyCharge).toEqual({ stored_value_cents: null, beauty_bank_cents: null, deposit_applied_cents: 0 });
      await run(`UPDATE ${q}.charges SET beauty_bank_cents = 275 WHERE id = '${legacyCharge.id}'`);
      expect((await run(`SELECT stored_value_cents, beauty_bank_cents FROM ${q}.charges WHERE id = '${legacyCharge.id}'`))[0]).toEqual({ stored_value_cents: 275, beauty_bank_cents: 275 });
      await run(`UPDATE ${q}.charges SET stored_value_cents = 325 WHERE id = '${legacyCharge.id}'`);
      expect((await run(`SELECT stored_value_cents, beauty_bank_cents FROM ${q}.charges WHERE id = '${legacyCharge.id}'`))[0]).toEqual({ stored_value_cents: 325, beauty_bank_cents: 325 });
      await expectPgCode("23514", () => run(`INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason, stored_value_cents, beauty_bank_cents) VALUES ('${appointmentCanonical.id}', '${ids.client}', 1000, 'service_payment', 10, 20)`));
      await expectPgCode("23514", () => run(`UPDATE ${q}.charges SET stored_value_cents = 10, beauty_bank_cents = 20 WHERE id = '${legacyCharge.id}'`));

      // Column-target upsert on the simple staff_services view works on PG17.
      const [upserted] = await run(`
        INSERT INTO ${q}.stylist_services (stylist_id, service_id, price_cents)
        VALUES ('${ids.provider2}', '${ids.service}', 7000)
        ON CONFLICT (stylist_id, service_id) DO UPDATE SET price_cents = EXCLUDED.price_cents
        RETURNING stylist_id::text, price_cents
      `);
      expect(upserted).toEqual({ stylist_id: ids.provider2, price_cents: 7000 });
      const [upsertedAgain] = await run(`
        INSERT INTO ${q}.stylist_services (stylist_id, service_id, price_cents)
        VALUES ('${ids.provider2}', '${ids.service}', 7100)
        ON CONFLICT (stylist_id, service_id) DO UPDATE SET price_cents = EXCLUDED.price_cents
        RETURNING stylist_id::text, price_cents
      `);
      expect(upsertedAgain).toEqual({ stylist_id: ids.provider2, price_cents: 7100 });

      // Named-constraint syntax is probed but is outside the guaranteed compatibility contract.
      const namedConstraintProbe = async (
        name: string,
      ): Promise<{ status: "supported" } | { status: "unsupported"; code: string }> => {
        try {
          await run(`
            INSERT INTO ${q}.stylist_services (stylist_id, service_id, price_cents)
            VALUES ('${ids.provider2}', '${ids.service}', 7200)
            ON CONFLICT ON CONSTRAINT "${name}" DO NOTHING
          `);
          return { status: "supported" };
        } catch (error) {
          const code = pgCode(error);
          if (code === "42704" || code === "0A000") return { status: "unsupported", code };
          throw error;
        }
      };
      const legacyNamedConstraint = await namedConstraintProbe("stylist_service_unique");
      const canonicalNamedConstraint = await namedConstraintProbe("staff_service_unique");
      // PostgreSQL 17 does not resolve either underlying table constraint name
      // through an automatically updatable view.
      expect(legacyNamedConstraint).toEqual({ status: "unsupported", code: "42704" });
      expect(canonicalNamedConstraint).toEqual({ status: "unsupported", code: "42704" });

      // Canonical constraints and unrelated triggers survive alongside 0060.
      await run(`
        INSERT INTO ${q}.appointments (staff_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider}', '${ids.client}', '${ids.service}', '${ids.location}', '[2040-01-01 10:00+00,2040-01-01 11:00+00)')
      `);
      await expectPgCode("23P01", () => run(`
        INSERT INTO ${q}.appointments (stylist_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider}', '${ids.client2}', '${ids.service}', '${ids.location}', '[2040-01-01 10:30+00,2040-01-01 11:30+00)')
      `));
      const [releaseAppointment] = await run(`
        INSERT INTO ${q}.appointments (stylist_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider3}', '${ids.client}', '${ids.service}', '${ids.location}', '[2041-01-01 10:00+00,2041-01-01 11:00+00)')
        RETURNING id::text
      `);
      const [resource] = await run(`INSERT INTO ${q}.resources (kind, name) VALUES ('equipment', 'Compatibility Resource') RETURNING id::text`);
      await run(`INSERT INTO ${q}.appointment_resources (appointment_id, resource_id, during) VALUES ('${releaseAppointment.id}', '${resource.id}', '[2041-01-01 10:00+00,2041-01-01 11:00+00)')`);
      await run(`UPDATE ${q}.appointments SET status = 'cancelled' WHERE id = '${releaseAppointment.id}'`);
      expect((await run(`SELECT count(*)::int AS count FROM ${q}.appointment_resources WHERE appointment_id = '${releaseAppointment.id}'`))[0].count).toBe(0);
      const [rebooked] = await run(`
        INSERT INTO ${q}.appointments (staff_id, client_id, service_id, location_id, during)
        VALUES ('${ids.provider3}', '${ids.client2}', '${ids.service}', '${ids.location}', '[2041-01-01 10:00+00,2041-01-01 11:00+00)')
        RETURNING id::text
      `);
      expect(rebooked.id).toBeTruthy();

      // FK cascade remains on child rows; calendar connection ownership remains NO ACTION.
      await run(`
        INSERT INTO ${q}.staff_services (staff_id, service_id) VALUES ('${ids.cascadeStaff}', '${ids.service}');
        INSERT INTO ${q}.working_hours (staff_id, day_of_week, start_time, end_time) VALUES ('${ids.cascadeStaff}', 6, '09:00', '10:00');
        INSERT INTO ${q}.time_blocks (staff_id, during) VALUES ('${ids.cascadeStaff}', '[2050-01-01 09:00+00,2050-01-01 10:00+00)');
        INSERT INTO ${q}.calendar_connections (staff_id, platform, access_token, refresh_token, token_expires_at)
        VALUES ('${ids.noActionStaff}', 'no-action-probe', 'access', 'refresh', '2051-01-01T00:00:00Z');
      `);
      await expectPgCode("23503", () => run(`DELETE FROM ${q}.stylists WHERE id = '${ids.noActionStaff}'`));
      await run(`DELETE FROM ${q}.calendar_connections WHERE staff_id = '${ids.noActionStaff}'`);
      await run(`DELETE FROM ${q}.stylists WHERE id = '${ids.noActionStaff}'`);
      await run(`DELETE FROM ${q}.stylists WHERE id = '${ids.cascadeStaff}'`);
      for (const table of ["staff_services", "working_hours", "time_blocks"]) {
        expect((await run(`SELECT count(*)::int AS count FROM ${q}."${table}" WHERE staff_id = '${ids.cascadeStaff}'`))[0].count).toBe(0);
      }

      // 0043 split shifts and 0057 hair deletion remain in force after 0060.
      const currentColumns = await run(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = '${schema}' AND ((table_name = 'clients' AND column_name = 'hair_types')
          OR (table_name = 'working_hours' AND column_name IN ('staff_id', 'stylist_id')))
        ORDER BY table_name, column_name
      `);
      expect(currentColumns.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([
        "working_hours.staff_id",
        "working_hours.stylist_id",
      ]);
    },
    180_000,
  );

  itDb(
    "preflight collisions roll back 0060 atomically and retry succeeds",
    async () => {
      const { slug, schema } = await provisionAt59("collision");
      const q = schemaPath(schema);
      await run(`CREATE TABLE ${q}.stylists (id integer)`);

      const { migrateTenant } = await import("./runner");
      const failed = await migrateTenant(slug, 59);
      expect(failed.toVersion).toBe(59);
      expect(failed.applied).toBe(0);
      expect(failed.error).toContain("legacy relation");
      const [version] = await run(`SELECT schema_version FROM public.tenants WHERE slug = '${slug}'`);
      expect(version.schema_version).toBe(59);
      const partial = await run(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = '${schema}' AND column_name IN ('legacy_stylist_role','stylist_id','beauty_bank_cents')
        UNION ALL
        SELECT table_name, '' AS column_name FROM information_schema.views WHERE table_schema = '${schema}'
      `);
      expect(partial).toEqual([]);

      await run(`DROP TABLE ${q}.stylists`);
      const retried = await migrateTenant(slug, 59);
      expect(retried.error).toBeUndefined();
      expect(retried.toVersion).toBe(60);
    },
    120_000,
  );

  itDb(
    "0060 is one atomic statement on non-primary runners and rejects canonical type drift",
    async () => {
      const { slug, schema } = await provisionAt59("atomic");
      const q = schemaPath(schema);
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      const { migration } = await import("./0060-domain-compatibility");
      const statements = migration.up(schema);
      expect(statements).toHaveLength(1);

      await run(`INSERT INTO ${q}.staff (display_name, role) VALUES ('Fail Atomic Backfill', 'provider')`);
      await publicDb.execute(sql.raw(`
        CREATE FUNCTION ${q}.fail_domain_compat_role_update() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog
        AS $fail_role$
        BEGIN
          RAISE EXCEPTION 'intentional 0060 atomicity probe';
        END
        $fail_role$
      `));
      await publicDb.execute(sql.raw(`
        CREATE TRIGGER fail_domain_compat_role_update
        BEFORE UPDATE ON ${q}.staff
        FOR EACH ROW EXECUTE FUNCTION ${q}.fail_domain_compat_role_update()
      `));

      // Execute 0060 directly with no runner transaction. The role backfill
      // fails after ALTER TABLE; PostgreSQL must roll back the full DO block.
      await expectPgCode("P0001", () => publicDb.execute(statements[0]));
      const assertNoCompatibilityObjects = async () => {
        const partial = await run(`
          SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = '${schema}' AND column_name IN ('legacy_stylist_role','stylist_id','beauty_bank_cents')
          UNION ALL
          SELECT table_name, '' AS column_name FROM information_schema.views WHERE table_schema = '${schema}'
          UNION ALL
          SELECT p.proname AS table_name, '' AS column_name FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = '${schema}' AND p.proname LIKE 'domain_compat_%_0060'
        `);
        expect(partial).toEqual([]);
      };
      await assertNoCompatibilityObjects();

      await publicDb.execute(sql.raw(`DROP TRIGGER fail_domain_compat_role_update ON ${q}.staff`));
      await publicDb.execute(sql.raw(`DROP FUNCTION ${q}.fail_domain_compat_role_update()`));
      await publicDb.execute(sql.raw(`ALTER TABLE ${q}.charges ALTER COLUMN stored_value_cents TYPE bigint`));
      await expectPgCode("42804", () => publicDb.execute(statements[0]));
      await assertNoCompatibilityObjects();
      const [version] = await run(`SELECT schema_version FROM public.tenants WHERE slug = '${slug}'`);
      expect(version.schema_version).toBe(59);
    },
    120_000,
  );

  itDb(
    "0060 down/up preserves canonical data and exactly removes only its compatibility objects",
    async () => {
      const { slug, schema } = await provisionAt59("roundtrip");
      const q = schemaPath(schema);
      const client = randomUUID();
      const staff = randomUUID();
      const service = randomUUID();
      await run(`
        INSERT INTO ${q}.clients (id, name) VALUES ('${client}', 'Round Trip');
        INSERT INTO ${q}.services (id, name, default_duration_minutes) VALUES ('${service}', 'Round Trip', 30);
        INSERT INTO ${q}.staff (id, display_name, role) VALUES ('${staff}', 'Round Trip Provider', 'provider');
        INSERT INTO ${q}.stored_value_transactions (client_id, type, amount_cents, running_balance_cents)
        VALUES ('${client}', 'admin_credit', 875, 875);
        INSERT INTO ${q}.business_settings (business_address, stored_value_expiry_months)
        VALUES ('Preserve this address', 15);
        INSERT INTO ${q}.working_hours (staff_id, day_of_week, start_time, end_time)
        VALUES ('${staff}', 2, '09:00', '12:00'), ('${staff}', 2, '13:00', '17:00');
      `);
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const fp59 = await schemaFingerprint(schema);
      const up = await migrateTenant(slug, 59);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(60);
      expect((await run(`SELECT role FROM ${q}.stylists WHERE id = '${staff}'`))[0].role).toBe("stylist");

      const down = await rollbackTenant(slug, 60, 59);
      expect(down.error).toBeUndefined();
      expect(down.toVersion).toBe(59);
      expect(await schemaFingerprint(schema)).toEqual(fp59);
      expect((await run(`SELECT role FROM ${q}.staff WHERE id = '${staff}'`))[0].role).toBe("provider");
      expect((await run(`SELECT business_address, stored_value_expiry_months FROM ${q}.business_settings`))[0]).toEqual({
        business_address: "Preserve this address",
        stored_value_expiry_months: 15,
      });
      expect((await run(`SELECT sum(amount_cents)::int AS total FROM ${q}.stored_value_transactions WHERE client_id = '${client}'`))[0].total).toBe(875);
      expect((await run(`SELECT count(*)::int AS count FROM ${q}.working_hours WHERE staff_id = '${staff}' AND day_of_week = 2`))[0].count).toBe(2);
      expect((await run(`SELECT count(*)::int AS count FROM information_schema.views WHERE table_schema = '${schema}'`))[0].count).toBe(0);
      expect((await run(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = '${schema}' AND column_name IN ('legacy_stylist_role','stylist_id','beauty_bank_cents')`))[0].count).toBe(0);
      expect((await run(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'clients' AND column_name = 'hair_types'`))[0].count).toBe(0);

      const again = await migrateTenant(slug, 59);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(60);
      expect((await run(`SELECT role FROM ${q}.stylists WHERE id = '${staff}'`))[0].role).toBe("stylist");
      expect((await run(`SELECT count(*)::int AS count FROM ${q}.working_hours WHERE staff_id = '${staff}' AND day_of_week = 2`))[0].count).toBe(2);
    },
    180_000,
  );

  itDb(
    "fresh provisioning and registry migration have matching schema, view, trigger, and function definitions",
    async () => {
      const freshSlug = makeSlug("fresh");
      const migrated = await provisionAt59("parity");
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant } = await import("./runner");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const freshSchema = `tenant_${freshSlug}`;
      await provisionTenantSchema({ name: "0060 fresh", slug: freshSlug });
      const up = await migrateTenant(migrated.slug, 59);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(60);
      expect(await schemaFingerprint(freshSchema)).toEqual(await schemaFingerprint(migrated.schema));
      expect(await compatibilityDefinitions(freshSchema)).toEqual(await compatibilityDefinitions(migrated.schema));
    },
    180_000,
  );
});
