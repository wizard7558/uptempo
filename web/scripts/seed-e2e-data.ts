import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  dropTenantSchema,
  provisionTenantSchema,
} from "../src/lib/tenant/provision";
import { tattoo } from "../src/lib/verticals/tattoo";
import { homeServices } from "../src/lib/verticals/home-services";
import { personalTraining } from "../src/lib/verticals/personal-training";
import {
  GYM_CLIENT_A_ID,
  GYM_CLIENT_B_ID,
  GYM_SCHEMA,
  GYM_SERVICE_ID,
  GYM_SLUG,
  GYM_STAFF_ID,
  GYM_TIMEZONE,
  seedGymClass,
} from "../tests/e2e/helpers/gym-class";
import { enumerateFlexHostSeedDays } from "../tests/e2e/helpers/flex-host-context";
import { addDays, dayOfWeekOf, localDay, wallClockToDate } from "../src/lib/scheduling/intervals";

/**
 * Load DATABASE_URL from .env.local when running via tsx (no Next.js env injection).
 */
function loadDatabaseUrlFromEnvLocal() {
  if (process.env.DATABASE_URL) return;
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "DATABASE_URL") continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env.DATABASE_URL = val;
    return;
  }
}

/**
 * Seed script for E2E test data.
 *
 * Drops and reprovisions the test tenant using the same path as production
 * (`provisionTenantSchema` + post-baseline migrations), then inserts minimal
 * rows for the public booking flow (policies, location-linked working hours,
 * stylist, services, test client).
 *
 * Also seeds several "host" appointments (processing-time blocks) so flex slots
 * appear on multiple future dates — keeps Playwright flex tests aligned without
 * re-running seed daily.
 *
 * Usage: npx tsx scripts/seed-e2e-data.ts
 *
 * Requires DATABASE_URL. Idempotent for the test-salon tenant.
 */

const TEST_TENANT_SLUG = "test-salon";
const TEST_TENANT_NAME = "Test Salon";
const SCHEMA_NAME = `tenant_${TEST_TENANT_SLUG}`;

const TEST_ADMIN_USER = {
  id: "e2e-test-user-001",
  email: "e2e-admin@test.bookuptempo.com",
  name: "E2E Admin",
};

/** Non-salon (tattoo) tenant used to prove industry-specific module gating. */
const STUDIO_SLUG = "test-studio";
const STUDIO_SCHEMA = `tenant_${STUDIO_SLUG}`;
/** Seeded studio rows the requests e2e relies on (the spec repeats these ids). */
const STUDIO_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000101";
const STUDIO_STAFF_ID = "f0e2e200-0000-4000-8000-0000000000a1";
/** The seeded multi-session project "Sleeve" (the projects e2e repeats these values). */
const STUDIO_PROJECT_ID = "f0e2e200-0000-4000-8000-000000000301";
const STUDIO_PROJECT_TOKEN = "e2eSleeveProjectToken0123456789a";
const STUDIO_USER = {
  id: "e2e-test-user-002",
  email: "e2e-studio@test.bookuptempo.com",
  name: "E2E Studio Owner",
};

/** Home-services tenant for the on-site (service areas, travel) e2e. */
const HOME_SLUG = "test-home";
const HOME_SCHEMA = `tenant_${HOME_SLUG}`;
const HOME_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000201";
const HOME_STAFF_ID = "f0e2e200-0000-4000-8000-0000000000c1";
const HOME_USER = {
  id: "e2e-test-user-003",
  email: "e2e-home@test.bookuptempo.com",
  name: "E2E Home Owner",
};

/** Personal-training tenant for the classes e2e (ids and the class live in tests/e2e/helpers/gym-class.ts). */
const GYM_USER = {
  id: "e2e-test-user-004",
  email: "e2e-gym@test.bookuptempo.com",
  name: "E2E Gym Owner",
};

/** Stable UUID for the seeded booking-flow test client (must match verify-code mock). */
const TEST_BOOKING_CLIENT_ID = "f0e2e200-0000-4000-8000-000000000001";

/** Blocks processing windows for flex E2E (not linked on stylist_services). */
const E2E_HOST_CLIENT_ID = "f0e2e201-0000-4000-8000-000000000001";

async function seed() {
  loadDatabaseUrlFromEnvLocal();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[E2E Seed] DATABASE_URL is not set (add it to .env.local or the environment)",
    );
  }
  const sql = postgres(process.env.DATABASE_URL);

  console.log("[E2E Seed] Starting test data seeding...");

  console.log("[E2E Seed] Cleaning up existing test data...");
  await sql`DELETE FROM "user" WHERE id = ${TEST_ADMIN_USER.id}`;
  await dropTenantSchema(TEST_TENANT_SLUG);
  await sql`DELETE FROM "user" WHERE id = ${STUDIO_USER.id}`;
  await dropTenantSchema(STUDIO_SLUG);
  await sql`DELETE FROM "user" WHERE id = ${HOME_USER.id}`;
  await dropTenantSchema(HOME_SLUG);
  await sql`DELETE FROM "user" WHERE id = ${GYM_USER.id}`;
  await dropTenantSchema(GYM_SLUG);

  console.log("[E2E Seed] Provisioning tenant schema (baseline + migrations)...");
  await provisionTenantSchema({
    name: TEST_TENANT_NAME,
    slug: TEST_TENANT_SLUG,
    timezone: "America/New_York",
  });

  // The admin layout gates un-launched tenants onto /onboarding
  // (resolveOnboardingRedirect), so the seeded salon must be marked launched.
  await sql`
    UPDATE tenants
    SET onboarding_steps = ${sql.json({ policies: true, branding: true, launched: true })}
    WHERE slug = ${TEST_TENANT_SLUG}
  `;

  // The walk-in line and slot waitlist are opt-in, so the e2e salon turns them on.
  await sql`
    UPDATE tenants SET modules = modules || '["walk_in_queue"]'::jsonb
    WHERE slug = ${TEST_TENANT_SLUG} AND NOT (modules @> '["walk_in_queue"]'::jsonb)
  `;
  await sql`
    UPDATE tenants SET modules = modules || '["slot_waitlist"]'::jsonb
    WHERE slug = ${TEST_TENANT_SLUG} AND NOT (modules @> '["slot_waitlist"]'::jsonb)
  `;
  await sql`
    UPDATE tenants SET modules = modules || '["gift_cards"]'::jsonb
    WHERE slug = ${TEST_TENANT_SLUG} AND NOT (modules @> '["gift_cards"]'::jsonb)
  `;

  // Admin user (public schema, better-auth)
  await sql`
    INSERT INTO "user" (id, email, name, email_verified, role, tenant_slug, created_at, updated_at)
    VALUES (${TEST_ADMIN_USER.id}, ${TEST_ADMIN_USER.email}, ${TEST_ADMIN_USER.name}, true, 'owner', ${TEST_TENANT_SLUG}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      role = 'owner', tenant_slug = ${TEST_TENANT_SLUG}, updated_at = NOW()
  `;

  // Admin routes resolve the role from memberships (7225a4f), so the admin
  // must be an owner member of the test tenant, not just a user row.
  await sql`
    INSERT INTO memberships (user_id, tenant_slug, role)
    VALUES (${TEST_ADMIN_USER.id}, ${TEST_TENANT_SLUG}, 'owner')
    ON CONFLICT (user_id, tenant_slug) DO UPDATE SET role = 'owner', updated_at = NOW()
  `;

  // Salon policies (card off for simpler E2E)
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."business_settings" (
      timezone, require_card_on_file, cancellation_window_hours,
      same_day_booking, min_notice_minutes
    )
    VALUES ('America/New_York', 0, 24, 1, 120)
  `);

  const [locationRow] = await sql.unsafe(
    `SELECT id FROM "${SCHEMA_NAME}"."locations" ORDER BY created_at ASC LIMIT 1`,
  ) as [{ id: string }];

  if (!locationRow?.id) {
    throw new Error("[E2E Seed] No location row after provision (expected m0008 seed)");
  }
  const locationId = locationRow.id;

  const [staffMember] = await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."staff" (display_name, bio, is_active)
    VALUES ('Test Stylist', 'E2E test stylist', 1)
    RETURNING id
  `) as [{ id: string }];

  const [service1] = await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."services" (
      name, default_duration_minutes, price_cents, is_active
    )
    VALUES ('Haircut', 30, 5000, 1)
    RETURNING id
  `) as [{ id: string }];

  const [service2] = await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."services" (
      name, default_duration_minutes, price_cents, is_active
    )
    VALUES ('Color', 60, 12000, 1)
    RETURNING id
  `) as [{ id: string }];

  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."staff_services" (staff_id, service_id)
    VALUES ('${staffMember.id}', '${service1.id}'), ('${staffMember.id}', '${service2.id}')
  `);

  for (let day = 1; day <= 5; day++) {
    await sql.unsafe(`
      INSERT INTO "${SCHEMA_NAME}"."working_hours"
        (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
      VALUES ('${staffMember.id}', ${day}, '09:00', '17:00', 1, '${locationId}')
    `);
  }
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."working_hours"
      (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
    VALUES ('${staffMember.id}', 6, '10:00', '15:00', 1, '${locationId}')
  `);

  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."clients" (id, name, email)
    VALUES ('${TEST_BOOKING_CLIENT_ID}', 'E2E Test Client', 'test@example.com')
  `);
  await sql.unsafe(`
    UPDATE "${SCHEMA_NAME}"."clients"
    SET attributes = '{"hair_types":["blonde","curly"]}'::jsonb
    WHERE id = '${TEST_BOOKING_CLIENT_ID}'
  `);
  await sql.unsafe(`
    UPDATE "${SCHEMA_NAME}"."clients" SET phone = '+15555550199' WHERE id = '${TEST_BOOKING_CLIENT_ID}'
  `);
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."sms_consent" (client_id, phone, consented_at, consent_method, consent_source)
    VALUES ('${TEST_BOOKING_CLIENT_ID}', '+15555550199', NOW(), 'admin_toggle', 'e2e')
  `);

  let offerDay = localDay(new Date(), "America/New_York");
  let weekdays = 0;
  for (let i = 0; i < 21 && weekdays < 3; i++) {
    offerDay = addDays(offerDay, 1);
    const dow = dayOfWeekOf(offerDay);
    if (dow !== 0 && dow !== 6) weekdays += 1;
  }
  const offerStart = wallClockToDate(offerDay, "14:00", "America/New_York");
  const offerEnd = new Date(offerStart.getTime() + 30 * 60_000);
  const claimToken = "e2eClaimToken0000000000000000001";
  const claimHash = createHash("sha256").update(claimToken).digest("hex");
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."slot_waitlist" (
      id, client_id, service_ids, staff_id, location_id,
      date_from, date_to, time_from, time_to,
      status, source, offer_token_hash, offer_expires_at,
      offered_staff_id, offered_start, offered_end, offered_location_id
    ) VALUES (
      'e2e00000-0000-4000-8000-00000000c1a1',
      '${TEST_BOOKING_CLIENT_ID}',
      '${JSON.stringify([service1.id])}'::jsonb,
      '${staffMember.id}',
      '${locationId}',
      '${offerDay}',
      '${offerDay}',
      '00:00',
      '23:59',
      'offered',
      'online',
      '${claimHash}',
      NOW() + interval '2 days',
      '${staffMember.id}',
      '${offerStart.toISOString()}'::timestamptz,
      '${offerEnd.toISOString()}'::timestamptz,
      '${locationId}'
    )
  `);

  // Host appointments: 45m active + 30m processing → flex gap fits a 30m "Haircut"
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."clients" (id, name, email, phone)
    VALUES ('${E2E_HOST_CLIENT_ID}', 'E2E Host Client', 'host-block@e2e.invalid', '+15555550198')
  `);
  await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."sms_consent" (client_id, phone, consented_at, consent_method, consent_source)
    VALUES ('${E2E_HOST_CLIENT_ID}', '+15555550198', NOW(), 'admin_toggle', 'e2e')
  `);

  const [hostService] = await sql.unsafe(`
    INSERT INTO "${SCHEMA_NAME}"."services" (
      name, default_duration_minutes, price_cents, is_active,
      active_minutes, processing_minutes
    )
    VALUES ('E2E Host Block', 75, 0, 1, 45, 30)
    RETURNING id
  `) as [{ id: string }];

  for (const { hostStart, hostEnd } of enumerateFlexHostSeedDays(14)) {
    const apptId = randomUUID();
    const startIso = hostStart.toISOString();
    const endIso = hostEnd.toISOString();

    await sql.unsafe(`
      INSERT INTO "${SCHEMA_NAME}"."appointments" (
        id, staff_id, client_id, location_id, during, status, is_double_book
      ) VALUES (
        '${apptId}',
        '${staffMember.id}',
        '${E2E_HOST_CLIENT_ID}',
        '${locationId}',
        tstzrange('${startIso}'::timestamptz, '${endIso}'::timestamptz, '[)'),
        'confirmed',
        0
      )
    `);

    await sql.unsafe(`
      INSERT INTO "${SCHEMA_NAME}"."appointment_services" (
        appointment_id, service_id, duration_minutes, is_override,
        price_charged_cents, active_minutes, processing_minutes
      ) VALUES (
        '${apptId}',
        '${hostService.id}',
        75,
        0,
        0,
        45,
        30
      )
    `);
  }

  console.log("[E2E Seed] Provisioning tattoo studio tenant...");
  await provisionTenantSchema({
    name: "Test Studio",
    slug: STUDIO_SLUG,
    timezone: "America/New_York",
  });
  await sql`
    UPDATE tenants
    SET industry = 'tattoo',
        modules = ${sql.json([...tattoo.modules])},
        onboarding_steps = ${sql.json({ policies: true, branding: true, launched: true })}
    WHERE slug = ${STUDIO_SLUG}
  `;
  await sql`
    INSERT INTO "user" (id, email, name, email_verified, role, tenant_slug, created_at, updated_at)
    VALUES (${STUDIO_USER.id}, ${STUDIO_USER.email}, ${STUDIO_USER.name}, true, 'owner', ${STUDIO_SLUG}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      role = 'owner', tenant_slug = ${STUDIO_SLUG}, updated_at = NOW()
  `;
  await sql`
    INSERT INTO memberships (user_id, tenant_slug, role)
    VALUES (${STUDIO_USER.id}, ${STUDIO_SLUG}, 'owner')
    ON CONFLICT (user_id, tenant_slug) DO UPDATE SET role = 'owner', updated_at = NOW()
  `;
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}"."business_settings" (
      timezone, require_card_on_file, cancellation_window_hours,
      same_day_booking, min_notice_minutes
    )
    VALUES ('America/New_York', 0, 24, 1, 120)
  `);
  await sql.unsafe(
    `UPDATE "${STUDIO_SCHEMA}".business_settings SET max_advance_days = 60`,
  );

  // Studio staff, services, hours and a client with a fake saved card (the
  // requests e2e: request -> quote -> accept with deposit).
  const [studioLocation] = (await sql.unsafe(
    `SELECT id FROM "${STUDIO_SCHEMA}"."locations" ORDER BY created_at ASC LIMIT 1`,
  )) as [{ id: string }];
  if (!studioLocation?.id) {
    throw new Error("[E2E Seed] No studio location row after provision");
  }
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".staff (id, display_name, is_active)
    VALUES ('${STUDIO_STAFF_ID}', 'Riley Artist', 1)
  `);
  // Books are always open at the start of a run; the books spec closes them and reopens them.
  await sql.unsafe(`UPDATE "${STUDIO_SCHEMA}".staff SET books_mode = 'open'`);
  await sql.unsafe(`DELETE FROM "${STUDIO_SCHEMA}".booking_windows`);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".services (id, name, default_duration_minutes, price_cents, is_active) VALUES
      ('f0e2e200-0000-4000-8000-0000000000b1', 'Consultation', 30, 0, 1),
      ('f0e2e200-0000-4000-8000-0000000000b2', 'Half-day session', 240, 60000, 1),
      ('f0e2e200-0000-4000-8000-0000000000b3', 'Flash', 60, 15000, 1)
  `);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".staff_services (staff_id, service_id)
    SELECT '${STUDIO_STAFF_ID}', id FROM "${STUDIO_SCHEMA}".services
  `);
  for (let day = 0; day <= 6; day++) {
    await sql.unsafe(`
      INSERT INTO "${STUDIO_SCHEMA}".working_hours
        (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
      VALUES ('${STUDIO_STAFF_ID}', ${day}, '10:00', '18:00', 1, '${studioLocation.id}')
    `);
  }
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".clients
      (id, name, email, phone, stripe_customer_id, stripe_payment_method_id)
    VALUES ('${STUDIO_CLIENT_ID}', 'Studio Client', 'studio-client@test.bookuptempo.com',
            '+15555550101', 'cus_e2e_studio', 'pm_e2e_studio')
  `);

  const photoDay = addDays(localDay(new Date(), "America/New_York"), 1);
  const photoStart = wallClockToDate(photoDay, "11:00", "America/New_York");
  const photoEnd = wallClockToDate(photoDay, "12:00", "America/New_York");
  const photoItems = JSON.stringify([
    { id: "s1", label: "Clean station" },
    { id: "s2", label: "Stencil approved" },
    { id: "s3", label: "Aftercare explained" },
  ]);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".services (id, name, default_duration_minutes, price_cents, is_active)
    VALUES ('e2e00000-0000-4000-8000-0000000057b1', 'Small tattoo', 60, 15000, 1)
    ON CONFLICT (id) DO UPDATE SET
      name = 'Small tattoo', default_duration_minutes = 60, price_cents = 15000, is_active = 1
  `);
  // Riley Artist stays the studio's only team member: the books spec closes Riley
  // and expects nobody left taking requests.
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".staff_services (staff_id, service_id)
    VALUES ('${STUDIO_STAFF_ID}', 'e2e00000-0000-4000-8000-0000000057b1')
    ON CONFLICT (staff_id, service_id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".clients (id, name, email, phone)
    VALUES (
      'e2e00000-0000-4000-8000-0000000057d1',
      'E2E Studio Client',
      'e2e-studio-photo@test.bookuptempo.com',
      '+15555550157'
    )
    ON CONFLICT (id) DO UPDATE SET name = 'E2E Studio Client'
  `);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".appointments (id, staff_id, client_id, location_id, during, status)
    VALUES (
      'e2e00000-0000-4000-8000-0000000057a1',
      '${STUDIO_STAFF_ID}',
      'e2e00000-0000-4000-8000-0000000057d1',
      '${studioLocation.id}',
      tstzrange('${photoStart.toISOString()}'::timestamptz, '${photoEnd.toISOString()}'::timestamptz, '[)'),
      'confirmed'
    )
    ON CONFLICT (id) DO UPDATE SET
      staff_id = EXCLUDED.staff_id,
      client_id = EXCLUDED.client_id,
      location_id = EXCLUDED.location_id,
      during = EXCLUDED.during,
      status = 'confirmed'
  `);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".appointment_services (id, appointment_id, service_id, duration_minutes)
    VALUES (
      'e2e00000-0000-4000-8000-0000000057e1',
      'e2e00000-0000-4000-8000-0000000057a1',
      'e2e00000-0000-4000-8000-0000000057b1',
      60
    )
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".checklist_templates (service_id, items)
    VALUES ('e2e00000-0000-4000-8000-0000000057b1', '${photoItems}'::jsonb)
    ON CONFLICT (service_id) DO UPDATE SET items = EXCLUDED.items, updated_at = now()
  `);

  // "Sleeve": a $1,200 project in 3 sessions with 2 done. A $200 deposit and two
  // $400 session payments leave $200 to pay and $200 of deposit credit. It has a
  // fixed access token and no design yet. Every insert is idempotent.
  await sql.unsafe(`
    INSERT INTO "${STUDIO_SCHEMA}".projects
      (id, client_id, staff_id, title, status, est_sessions, quoted_total_cents, access_token)
    VALUES ('${STUDIO_PROJECT_ID}', '${STUDIO_CLIENT_ID}', '${STUDIO_STAFF_ID}', 'Sleeve',
            'in_progress', 3, 120000, '${STUDIO_PROJECT_TOKEN}')
    ON CONFLICT (id) DO NOTHING
  `);
  const sleeveSessions = [
    { id: "f0e2e200-0000-4000-8000-000000000311", daysAgo: 21, payment: "f0e2e200-0000-4000-8000-000000000321", deposit: true },
    { id: "f0e2e200-0000-4000-8000-000000000312", daysAgo: 14, payment: "f0e2e200-0000-4000-8000-000000000322", deposit: false },
  ];
  for (const sess of sleeveSessions) {
    await sql.unsafe(`
      INSERT INTO "${STUDIO_SCHEMA}".appointments (id, staff_id, client_id, location_id, during, status, project_id)
      VALUES ('${sess.id}', '${STUDIO_STAFF_ID}', '${STUDIO_CLIENT_ID}', '${studioLocation.id}',
              tstzrange(date_trunc('day', now()) - interval '${sess.daysAgo} days' + interval '14 hours',
                        date_trunc('day', now()) - interval '${sess.daysAgo} days' + interval '18 hours'),
              'completed', '${STUDIO_PROJECT_ID}')
      ON CONFLICT (id) DO NOTHING
    `);
    if (sess.deposit) {
      await sql.unsafe(`
        INSERT INTO "${STUDIO_SCHEMA}".charges (id, appointment_id, client_id, amount_cents, reason, status)
        VALUES ('f0e2e200-0000-4000-8000-000000000331', '${sess.id}', '${STUDIO_CLIENT_ID}', 20000, 'deposit', 'completed')
        ON CONFLICT (id) DO NOTHING
      `);
    }
    await sql.unsafe(`
      INSERT INTO "${STUDIO_SCHEMA}".charges (id, appointment_id, client_id, amount_cents, reason, status)
      VALUES ('${sess.payment}', '${sess.id}', '${STUDIO_CLIENT_ID}', 40000, 'service_payment', 'completed')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  console.log("[E2E Seed] Provisioning home services tenant...");
  await provisionTenantSchema({
    name: "Test Home Services",
    slug: HOME_SLUG,
    timezone: "America/New_York",
  });
  await sql`
    UPDATE tenants
    SET industry = 'home_services',
        modules = ${sql.json([...new Set([...homeServices.modules, "on_site"])])},
        onboarding_steps = ${sql.json({ policies: true, branding: true, launched: true })}
    WHERE slug = ${HOME_SLUG}
  `;
  await sql`
    INSERT INTO "user" (id, email, name, email_verified, role, tenant_slug, created_at, updated_at)
    VALUES (${HOME_USER.id}, ${HOME_USER.email}, ${HOME_USER.name}, true, 'owner', ${HOME_SLUG}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      role = 'owner', tenant_slug = ${HOME_SLUG}, updated_at = NOW()
  `;
  await sql`
    INSERT INTO memberships (user_id, tenant_slug, role)
    VALUES (${HOME_USER.id}, ${HOME_SLUG}, 'owner')
    ON CONFLICT (user_id, tenant_slug) DO UPDATE SET role = 'owner', updated_at = NOW()
  `;
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}"."business_settings" (
      timezone, require_card_on_file, cancellation_window_hours,
      same_day_booking, min_notice_minutes
    )
    VALUES ('America/New_York', 0, 24, 1, 120)
  `);
  const [homeLocation] = (await sql.unsafe(
    `SELECT id FROM "${HOME_SCHEMA}"."locations" ORDER BY created_at ASC LIMIT 1`,
  )) as [{ id: string }];
  if (!homeLocation?.id) {
    throw new Error("[E2E Seed] No home services location row after provision");
  }
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".staff (id, display_name, is_active)
    VALUES ('${HOME_STAFF_ID}', 'Sam Tech', 1)
  `);
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".services
      (id, name, default_duration_minutes, price_cents, is_active, location_type)
    VALUES ('f0e2e200-0000-4000-8000-0000000000d1', 'Standard clean', 120, 14000, 1, 'on_site')
  `);
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".staff_services (staff_id, service_id)
    SELECT '${HOME_STAFF_ID}', id FROM "${HOME_SCHEMA}".services
  `);
  for (let day = 1; day <= 6; day++) {
    await sql.unsafe(`
      INSERT INTO "${HOME_SCHEMA}".working_hours
        (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
      VALUES ('${HOME_STAFF_ID}', ${day}, '08:00', '17:00', 1, '${homeLocation.id}')
    `);
  }
  // Sam starts the day near 10001 and the business serves three Manhattan ZIP codes.
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".staff_travel_settings
      (staff_id, base_postal_code, base_lat, base_lng, speed_kmh, max_travel_min)
    VALUES ('${HOME_STAFF_ID}', '10001', 40.75060, -73.99700, 40, 60)
  `);
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".service_areas (name, kind, postal_codes)
    VALUES ('Manhattan', 'postal_codes', '{10001,10002,10003}')
  `);
  await sql.unsafe(`
    INSERT INTO "${HOME_SCHEMA}".clients (id, name, email, phone)
    VALUES ('${HOME_CLIENT_ID}', 'Home Customer', 'home-customer@test.bookuptempo.com', '+15555550102')
  `);

  console.log("[E2E Seed] Provisioning personal training (gym) tenant...");
  await provisionTenantSchema({
    name: "Test Gym",
    slug: GYM_SLUG,
    timezone: GYM_TIMEZONE,
  });
  await sql`
    UPDATE tenants
    SET industry = 'personal_training',
        modules = ${sql.json([...new Set([...personalTraining.modules, "classes", "packages"])])},
        onboarding_steps = ${sql.json({ policies: true, branding: true, launched: true })}
    WHERE slug = ${GYM_SLUG}
  `;
  await sql`
    INSERT INTO "user" (id, email, name, email_verified, role, tenant_slug, created_at, updated_at)
    VALUES (${GYM_USER.id}, ${GYM_USER.email}, ${GYM_USER.name}, true, 'owner', ${GYM_SLUG}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      role = 'owner', tenant_slug = ${GYM_SLUG}, updated_at = NOW()
  `;
  await sql`
    INSERT INTO memberships (user_id, tenant_slug, role)
    VALUES (${GYM_USER.id}, ${GYM_SLUG}, 'owner')
    ON CONFLICT (user_id, tenant_slug) DO UPDATE SET role = 'owner', updated_at = NOW()
  `;
  await sql.unsafe(`
    INSERT INTO "${GYM_SCHEMA}"."business_settings" (
      timezone, require_card_on_file, cancellation_window_hours,
      same_day_booking, min_notice_minutes
    )
    VALUES ('${GYM_TIMEZONE}', 0, 24, 1, 120)
  `);
  await sql.unsafe(`
    INSERT INTO "${GYM_SCHEMA}".staff (id, display_name, is_active)
    VALUES ('${GYM_STAFF_ID}', 'Jordan Trainer', 1)
  `);
  await sql.unsafe(`
    INSERT INTO "${GYM_SCHEMA}".services
      (id, name, default_duration_minutes, price_cents, is_active, is_class, class_capacity)
    VALUES ('${GYM_SERVICE_ID}', 'Bootcamp', 45, 2000, 1, 1, 12)
  `);
  await sql.unsafe(`
    INSERT INTO "${GYM_SCHEMA}".staff_services (staff_id, service_id)
    VALUES ('${GYM_STAFF_ID}', '${GYM_SERVICE_ID}')
  `);
  await sql.unsafe(`
    INSERT INTO "${GYM_SCHEMA}".clients (id, name, email, phone)
    VALUES ('${GYM_CLIENT_A_ID}', 'Gym A', 'gym-a@test.bookuptempo.com', '+15555550103'),
           ('${GYM_CLIENT_B_ID}', 'Gym B', 'gym-b@test.bookuptempo.com', '+15555550104')
  `);
  // Tomorrow 06:00, one seat, Gym A booked with a credit. Safe to run again: it replaces the class.
  await seedGymClass(sql);

  await sql.end();
  console.log("[E2E Seed] Done! Test data seeded successfully.");
}

seed()
  .then(() => {
    // provisionTenantSchema opens a separate pooled connection via publicDb that
    // otherwise keeps the event loop alive, so exit explicitly once seeding is
    // done (also lets `e2e:serve` proceed to `npm run dev`).
    process.exit(0);
  })
  .catch((err) => {
    console.error("[E2E Seed] Failed:", err);
    process.exit(1);
  });
