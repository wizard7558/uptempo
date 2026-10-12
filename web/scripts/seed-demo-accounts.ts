/**
 * Creates or removes the labeled demo tenants.
 *
 * Passwords are random and written only to DEMO_CREDENTIALS_FILE, which must
 * sit outside the repository. Nothing in this file is a password.
 *
 * Demo tenants never call Stripe. Gift cards are comps.
 *
 * DEMO_SEED_TARGET=rehearsal  only a cutover rehearsal compute
 * DEMO_SEED_TARGET=production only with DEMO_SEED_CONFIRM=cutover-approved
 * DEMO_SEED_MODE=remove       drops just the demo-* tenants in this file
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import {
  formatGiftCardCode,
  generateGiftCardCode,
  giftCardLast4,
  hashGiftCardCode,
} from "../src/lib/gift-cards/code";
import { dropTenantSchema, provisionTenantSchema } from "../src/lib/tenant/provision";
import { getVertical } from "../src/lib/verticals";

const REHEARSAL_HOST_PREFIXES = ["ep-autumn-sea-aklzr63s", "ep-divine-mouse-akbfhf31"];
const SLUGS = [
  "demo-salon",
  "demo-barber",
  "demo-nails",
  "demo-tattoo",
  "demo-massage",
  "demo-studio",
  "demo-walkin",
] as const;

type DemoSlug = (typeof SLUGS)[number];

type CatalogItem = {
  name: string;
  minutes: number;
  cents: number;
  isClass: number;
  capacity: number | null;
};

const DEMOS: Record<
  DemoSlug,
  {
    name: string;
    industry: string;
    extraModules: string[];
    classes: boolean;
    walkIn: boolean;
    catalog: CatalogItem[];
  }
> = {
  "demo-salon": {
    name: "Demo Salon",
    industry: "hair_salon",
    extraModules: [],
    classes: false,
    walkIn: false,
    catalog: [
      { name: "Cut and style", minutes: 60, cents: 8500, isClass: 0, capacity: null },
      { name: "Color gloss", minutes: 45, cents: 9500, isClass: 0, capacity: null },
    ],
  },
  "demo-barber": {
    name: "Demo Barber",
    industry: "barber",
    extraModules: [],
    classes: false,
    walkIn: false,
    catalog: [
      { name: "Haircut", minutes: 30, cents: 3500, isClass: 0, capacity: null },
      { name: "Beard trim", minutes: 20, cents: 2000, isClass: 0, capacity: null },
    ],
  },
  "demo-nails": {
    name: "Demo Nails",
    industry: "nail_salon",
    extraModules: [],
    classes: false,
    walkIn: false,
    catalog: [
      { name: "Gel manicure", minutes: 45, cents: 4500, isClass: 0, capacity: null },
      { name: "Classic pedicure", minutes: 50, cents: 5000, isClass: 0, capacity: null },
    ],
  },
  "demo-tattoo": {
    name: "Demo Tattoo",
    industry: "tattoo",
    extraModules: [],
    classes: false,
    walkIn: false,
    catalog: [
      { name: "Consultation", minutes: 30, cents: 0, isClass: 0, capacity: null },
      { name: "Flash piece", minutes: 60, cents: 15000, isClass: 0, capacity: null },
    ],
  },
  "demo-massage": {
    name: "Demo Massage",
    industry: "massage_wellness",
    extraModules: [],
    classes: false,
    walkIn: false,
    catalog: [
      { name: "Swedish massage, 60 min", minutes: 60, cents: 11000, isClass: 0, capacity: null },
      { name: "Express facial", minutes: 30, cents: 6500, isClass: 0, capacity: null },
    ],
  },
  "demo-studio": {
    name: "Demo Studio",
    industry: "personal_training",
    extraModules: ["classes"],
    classes: true,
    walkIn: false,
    catalog: [
      { name: "Mat class", minutes: 50, cents: 3500, isClass: 1, capacity: 8 },
      { name: "Intro session", minutes: 30, cents: 4000, isClass: 0, capacity: null },
    ],
  },
  "demo-walkin": {
    name: "Demo Walk-in",
    industry: "hair_salon",
    extraModules: ["walk_in_queue"],
    classes: false,
    walkIn: true,
    catalog: [
      { name: "Walk-in cut", minutes: 30, cents: 4500, isClass: 0, capacity: null },
      { name: "Bang trim", minutes: 15, cents: 2000, isClass: 0, capacity: null },
    ],
  },
};

type Login = {
  tenant: DemoSlug;
  tenantUrl: string;
  email: string;
  role: "owner" | "staff" | "client";
  password: string;
  giftCardCode?: string;
};

function assertTarget() {
  const target = process.env.DEMO_SEED_TARGET;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const host = new URL(url).host;
  const rehearsal = REHEARSAL_HOST_PREFIXES.some((prefix) => host.startsWith(prefix));
  if (target === "rehearsal") {
    if (!rehearsal) {
      throw new Error("Refusing to seed: DATABASE_URL is not the rehearsal branch");
    }
    return;
  }
  if (target === "production") {
    if (process.env.DEMO_SEED_CONFIRM !== "cutover-approved") {
      throw new Error("Refusing to seed production without DEMO_SEED_CONFIRM=cutover-approved");
    }
    if (rehearsal) {
      throw new Error("Refusing to seed: this is the rehearsal branch, not production");
    }
    return;
  }
  throw new Error("Set DEMO_SEED_TARGET to rehearsal or production");
}

function emailFor(slug: DemoSlug, role: "owner" | "staff" | "client") {
  return `${role}@${slug}.example`;
}

function reusedPassword(slug: DemoSlug, role: "owner" | "staff" | "client") {
  if (process.env.DEMO_REUSE_PASSWORDS !== "1") return null;
  const existing = JSON.parse(readFileSync(credentialsPath(), "utf8")) as { logins: Login[] };
  const found = existing.logins.find((login) => login.email === emailFor(slug, role));
  if (!found) return null;
  if (!found.password) throw new Error(`No saved password for ${emailFor(slug, role)}`);
  return found.password;
}

function credentialsPath() {
  const file = process.env.DEMO_CREDENTIALS_FILE;
  if (!file) throw new Error("Set DEMO_CREDENTIALS_FILE to a path outside the repo");
  const absolute = resolve(file);
  if (absolute.startsWith(resolve(process.cwd())) || absolute.includes("/web/")) {
    throw new Error("DEMO_CREDENTIALS_FILE must be outside the repository");
  }
  return absolute;
}

async function removeDemos(sql: ReturnType<typeof postgres>) {
  const emails = SLUGS.flatMap((slug) =>
    (["owner", "staff", "client"] as const).map((role) => emailFor(slug, role)),
  );
  await sql`
    DELETE FROM session
    WHERE user_id IN (SELECT id FROM "user" WHERE email IN ${sql(emails)})
  `;
  await sql`
    DELETE FROM account
    WHERE user_id IN (SELECT id FROM "user" WHERE email IN ${sql(emails)})
  `;
  await sql`DELETE FROM memberships WHERE tenant_slug IN ${sql([...SLUGS])}`;
  await sql`DELETE FROM "user" WHERE email IN ${sql(emails)}`;
  for (const slug of SLUGS) {
    await dropTenantSchema(slug);
  }
}

async function seedOne(
  sql: ReturnType<typeof postgres>,
  slug: DemoSlug,
  appOrigin: string,
): Promise<Login[]> {
  const demo = DEMOS[slug];
  const schema = `tenant_${slug}`;
  await provisionTenantSchema({
    name: demo.name,
    slug,
    timezone: "America/New_York",
  });
  const modules = [...new Set([...getVertical(demo.industry).modules, ...demo.extraModules])];
  await sql`
    UPDATE tenants
    SET industry = ${demo.industry},
        modules = ${sql.json(modules)},
        onboarding_steps = ${sql.json({ policies: true, branding: true, launched: true })},
        name = ${demo.name}
    WHERE slug = ${slug}
  `;

  const [location] = await sql<{ id: string }[]>`
    INSERT INTO ${sql(schema)}.locations (name, address, is_active)
    VALUES (${`${demo.name} floor`}, '100 Demo Street, New York, NY', 1)
    RETURNING id
  `;

  await sql`
    INSERT INTO ${sql(schema)}.business_settings (timezone, queue_open, waitlist_hold_minutes, policy_text)
    VALUES (
      'America/New_York',
      ${demo.walkIn ? 1 : 0},
      15,
      'Demo data. Cards are comps and no Stripe charge is created.'
    )
  `;

  const logins: Login[] = [];
  const userIds: Record<"owner" | "staff" | "client", string> = {
    owner: "",
    staff: "",
    client: "",
  };
  for (const role of ["owner", "staff", "client"] as const) {
    const id = `demo-${slug}-${role}`;
    const email = emailFor(slug, role);
    const password = reusedPassword(slug, role) ?? randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(password);
    const appRole = role === "staff" ? "provider" : role;
    const name =
      role === "owner" ? `${demo.name} Owner` : role === "staff" ? `${demo.name} Staff` : `${demo.name} Client`;
    await sql`
      INSERT INTO "user" (id, name, email, email_verified, role, tenant_slug, updated_at)
      VALUES (${id}, ${name}, ${email}, true, ${appRole}, ${slug}, now())
    `;
    await sql`
      INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at)
      VALUES (${`${id}-password`}, ${id}, 'credential', ${id}, ${passwordHash}, now())
    `;
    if (role !== "client") {
      await sql`
        INSERT INTO memberships (user_id, tenant_slug, role)
        VALUES (${id}, ${slug}, ${role === "owner" ? "owner" : "provider"})
      `;
    }
    userIds[role] = id;
    logins.push({
      tenant: slug,
      tenantUrl: `${appOrigin}/book/${slug}`,
      email,
      role,
      password,
    });
  }

  const [staff] = await sql<{ id: string }[]>`
    INSERT INTO ${sql(schema)}.staff (user_id, email, display_name, role, is_active, books_mode)
    VALUES (${userIds.staff}, ${emailFor(slug, "staff")}, ${`${demo.name} Staff`}, 'provider', 1, 'open')
    RETURNING id
  `;
  for (let day = 1; day <= 6; day += 1) {
    await sql`
      INSERT INTO ${sql(schema)}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
      VALUES (${staff.id}, ${day}, '09:00', '17:00', 1, ${location.id})
    `;
  }

  const serviceIds: string[] = [];
  for (const item of demo.catalog) {
    const [service] = await sql<{ id: string }[]>`
      INSERT INTO ${sql(schema)}.services (
        name, default_duration_minutes, price_cents, is_active, online_bookable,
        is_class, class_capacity, description
      ) VALUES (
        ${item.name}, ${item.minutes}, ${item.cents}, 1, 1,
        ${item.isClass}, ${item.capacity}, ${"Demo service. No card is charged."}
      )
      RETURNING id
    `;
    serviceIds.push(service.id);
    await sql`
      INSERT INTO ${sql(schema)}.staff_services (staff_id, service_id)
      VALUES (${staff.id}, ${service.id})
    `;
  }

  const [client] = await sql<{ id: string }[]>`
    INSERT INTO ${sql(schema)}.clients (name, email, phone, notes)
    VALUES (
      ${`${demo.name} Client`},
      ${emailFor(slug, "client")},
      '555-0100',
      'Demo client. Safe to delete with the demo tenant.'
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO ${sql(schema)}.appointments (
      staff_id, client_id, service_id, location_id, during, status, notes,
      calendar_sync_status, client_status_at_booking, deposit_cents
    ) VALUES (
      ${staff.id},
      ${client.id},
      ${serviceIds[0]},
      ${location.id},
      tstzrange(
        ((now() + interval '1 day')::date + time '15:00') AT TIME ZONE 'America/New_York',
        ((now() + interval '1 day')::date + time '16:00') AT TIME ZONE 'America/New_York'
      ),
      'confirmed',
      'Demo appointment. No payment was taken.',
      'synced',
      'new',
      0
    )
  `;

  const code = generateGiftCardCode();
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO ${sql(schema)}.gift_cards (
      code_hash, last4, initial_cents, balance_cents, status, source,
      purchaser_client_id, purchaser_name, recipient_name, message, created_by
    ) VALUES (
      ${hashGiftCardCode(code)},
      ${giftCardLast4(code)},
      5000,
      5000,
      'active',
      'comp',
      ${client.id},
      ${`${demo.name} Owner`},
      ${`${demo.name} Client`},
      'Demo comp. No Stripe charge.',
      ${userIds.owner}
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO ${sql(schema)}.gift_card_transactions (
      gift_card_id, delta_cents, balance_after_cents, reason, note, created_by
    ) VALUES (
      ${card.id}, 5000, 5000, 'issue', 'Demo comp', ${userIds.owner}
    )
  `;
  logins[0].giftCardCode = formatGiftCardCode(code);

  await sql`
    INSERT INTO ${sql(schema)}.slot_waitlist (
      client_id, service_ids, staff_id, location_id, date_from, date_to, status, source
    ) VALUES (
      ${client.id},
      ${sql.json(serviceIds.slice(0, 1))},
      ${staff.id},
      ${location.id},
      (now() + interval '2 day')::date,
      (now() + interval '16 day')::date,
      'waiting',
      'front_desk'
    )
  `;

  if (demo.classes) {
    const classService = serviceIds[0];
    const [session] = await sql<{ id: string }[]>`
      INSERT INTO ${sql(schema)}.class_sessions (
        service_id, staff_id, location_id, during, capacity, price_cents, notes
      ) VALUES (
        ${classService},
        ${staff.id},
        ${location.id},
        tstzrange(
          ((now() + interval '2 day')::date + time '10:00') AT TIME ZONE 'America/New_York',
          ((now() + interval '2 day')::date + time '10:50') AT TIME ZONE 'America/New_York'
        ),
        8,
        3500,
        'Demo class. No payment was taken.'
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO ${sql(schema)}.class_enrollments (session_id, client_id, status)
      VALUES (${session.id}, ${client.id}, 'booked')
    `;
  }

  if (demo.walkIn) {
    const token = randomBytes(16).toString("hex");
    await sql`
      INSERT INTO ${sql(schema)}.queue_entries (
        location_id, client_id, name, phone, service_id, preferred_staff_id,
        status, source, public_token_hash, notes
      ) VALUES (
        ${location.id},
        ${client.id},
        'Demo walk-in guest',
        '555-0199',
        ${serviceIds[0]},
        ${staff.id},
        'waiting',
        'front_desk',
        ${createHash("sha256").update(token).digest("hex")},
        'Demo queue row. Safe to delete with the tenant.'
      )
    `;
  }

  return logins;
}

async function main() {
  assertTarget();
  const mode = process.env.DEMO_SEED_MODE ?? "create";
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    if (mode === "remove") {
      await removeDemos(sql);
      console.log(`[demo] removed ${SLUGS.join(", ")}`);
      return;
    }
    if (mode !== "create") throw new Error("DEMO_SEED_MODE must be create or remove");
    await removeDemos(sql);
    const origin = (process.env.DEMO_APP_ORIGIN ?? "https://www.bookuptempo.com").replace(/\/$/, "");
    const logins: Login[] = [];
    for (const slug of SLUGS) {
      logins.push(...(await seedOne(sql, slug, origin)));
      console.log(`[demo] seeded ${slug}`);
    }
    const file = credentialsPath();
    writeFileSync(file, `${JSON.stringify({ createdAt: new Date().toISOString(), logins }, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(file, 0o600);
    console.log(`[demo] wrote credentials for ${logins.length} logins`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
