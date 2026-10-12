import { sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { getShardClient, getShardForSlug, newTenantShard } from "@/lib/db/shards";
import { tenants } from "@/lib/db/schema";
import { hairSalon } from "@/lib/verticals/hair-salon";
import { slugSchema } from "./slug-validation";
import {
  getMigrationsAfterBaseline,
  TENANT_BASELINE_VERSION,
} from "./migrations";

/**
 * Provisions a complete tenant schema with all tables, indexes, constraints,
 * and foreign keys. Uses raw SQL because drizzle-kit cannot handle dynamic
 * schema names.
 *
 * The slug is validated before use in SQL as defense in depth against injection.
 * Everything runs inside a transaction for atomicity.
 */
export async function provisionTenantSchema(data: {
  name: string;
  slug: string;
  timezone?: string;
  /** Test hook: stop after this registry version; default LATEST. */
  throughVersion?: number;
}): Promise<{ tenantId: string; schemaName: string }> {
  // Validate slug to prevent SQL injection in schema names
  slugSchema.parse(data.slug);

  const schemaName = `tenant_${data.slug}`;
  const shardName = newTenantShard();
  // Primary keeps the registry insert on the same transaction as the DDL.
  const ddl = (
    shardName === "primary" ? publicDb : getShardClient(shardName).db
  ) as typeof publicDb;

  const result = await ddl.transaction(async (tx) => {
    // 1. Create the schema
    await tx.execute(
      sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
    );

    // 2. Ensure btree_gist extension is available (needed for exclusion constraint)
    await tx.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist`));

    // 3. Create tables in dependency order

    // -- services (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."services" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "default_duration_minutes" integer NOT NULL,
        "price_cents" integer,
        "active_minutes" integer,
        "processing_minutes" integer,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- clients (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."clients" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "email" text,
        "phone" text,
        "stripe_customer_id" text,
        "stripe_payment_method_id" text,
        "notes" text,
        "birthday" date,
        "gender" text,
        "address" text,
        "city" text,
        "state" text,
        "zip" text,
        "customer_since" date,
        "appointments_booked" integer DEFAULT 0 NOT NULL,
        "source" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- stylists (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."stylists" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" text,
        "email" text,
        "display_name" text NOT NULL,
        "photo_url" text,
        "bio" text,
        "role" text DEFAULT 'stylist' NOT NULL,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- client_service_overrides (FKs: clients, services)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."client_service_overrides" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id") ON DELETE CASCADE,
        "service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "duration_minutes" integer NOT NULL,
        "active_minutes" integer,
        "processing_minutes" integer,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "client_service_override_unique" UNIQUE("client_id", "service_id")
      )
    `));

    // -- stylist_services (FKs: stylists, services)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."stylist_services" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "stylist_id" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id") ON DELETE CASCADE,
        "service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "stylist_service_unique" UNIQUE("stylist_id", "service_id")
      )
    `));

    // -- appointments (FKs: clients, services)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."appointments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "stylist_id" uuid NOT NULL,
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id"),
        "service_id" uuid REFERENCES "${schemaName}"."services"("id"),
        "during" tstzrange NOT NULL,
        "status" text DEFAULT 'confirmed' NOT NULL,
        "notes" text,
        "is_double_book" integer DEFAULT 0 NOT NULL,
        "calendar_event_id" text,
        "calendar_sync_status" text DEFAULT 'pending',
        "reminder_sent_at" timestamp with time zone,
        "sms_reminder_sent_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- appointment_services (FKs: appointments, services)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."appointment_services" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "appointment_id" uuid NOT NULL REFERENCES "${schemaName}"."appointments"("id") ON DELETE CASCADE,
        "service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id"),
        "duration_minutes" integer NOT NULL,
        "is_override" integer DEFAULT 0 NOT NULL,
        "price_charged_cents" integer,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- working_hours (FK: stylists)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."working_hours" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "stylist_id" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id") ON DELETE CASCADE,
        "day_of_week" integer NOT NULL,
        "start_time" text NOT NULL,
        "end_time" text NOT NULL,
        "is_enabled" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "working_hours_stylist_day_unique" UNIQUE("stylist_id", "day_of_week")
      )
    `));

    // -- salon_policies (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."salon_policies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "timezone" text DEFAULT 'America/New_York' NOT NULL,
        "cancellation_window_hours" integer DEFAULT 24 NOT NULL,
        "cancellation_fee_percent" integer DEFAULT 50 NOT NULL,
        "no_show_fee_percent" integer DEFAULT 100 NOT NULL,
        "require_card_on_file" integer DEFAULT 1 NOT NULL,
        "confirmation_enabled" integer DEFAULT 1 NOT NULL,
        "reminder_enabled" integer DEFAULT 1 NOT NULL,
        "reminder_hours_before" integer DEFAULT 24 NOT NULL,
        "confirmation_greeting" text,
        "confirmation_body" text,
        "reminder_greeting" text,
        "reminder_body" text,
        "salon_address" text,
        "apple_pay_enabled" integer DEFAULT 1 NOT NULL,
        "google_pay_enabled" integer DEFAULT 1 NOT NULL,
        "afterpay_enabled" integer DEFAULT 1 NOT NULL,
        "cashapp_enabled" integer DEFAULT 1 NOT NULL,
        "sms_reminders_enabled" integer DEFAULT 0 NOT NULL,
        "sms_reminder_hours_before" integer DEFAULT 24 NOT NULL,
        "sms_reminder_body" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- charges (FKs: appointments, clients)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."charges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "appointment_id" uuid NOT NULL REFERENCES "${schemaName}"."appointments"("id"),
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id"),
        "stripe_payment_intent_id" text,
        "amount_cents" integer NOT NULL,
        "reason" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "stripe_refund_id" text,
        "failure_reason" text,
        "platform_fee_cents" integer,
        "connect_account_id" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- booking_verifications (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."booking_verifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "identifier" text NOT NULL,
        "type" text NOT NULL,
        "code" text NOT NULL,
        "attempts" integer DEFAULT 0 NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- calendar_connections (FK: stylists)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."calendar_connections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "stylist_id" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id"),
        "platform" text NOT NULL,
        "access_token" text NOT NULL,
        "refresh_token" text NOT NULL,
        "token_expires_at" timestamp with time zone NOT NULL,
        "platform_user_id" text,
        "platform_email" text,
        "calendar_id" text,
        "status" text DEFAULT 'active' NOT NULL,
        "error_message" text,
        "error_count" integer DEFAULT 0 NOT NULL,
        "last_synced_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- external_events (FK: calendar_connections)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."external_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "connection_id" uuid NOT NULL REFERENCES "${schemaName}"."calendar_connections"("id") ON DELETE CASCADE,
        "stylist_id" uuid NOT NULL,
        "calendar_id" text NOT NULL,
        "event_uid" text,
        "start_time" timestamp with time zone NOT NULL,
        "end_time" timestamp with time zone NOT NULL,
        "is_all_day" integer DEFAULT 0 NOT NULL,
        "free_busy_status" text DEFAULT 'busy' NOT NULL,
        "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- form_templates (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."form_templates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- service_form_assignments (FKs: services, form_templates)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."service_form_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "form_template_id" uuid NOT NULL REFERENCES "${schemaName}"."form_templates"("id") ON DELETE CASCADE,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "service_form_assignment_unique" UNIQUE("service_id", "form_template_id")
      )
    `));

    // -- form_responses (FKs: form_templates, appointments, clients)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."form_responses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "form_template_id" uuid NOT NULL REFERENCES "${schemaName}"."form_templates"("id"),
        "appointment_id" uuid NOT NULL REFERENCES "${schemaName}"."appointments"("id"),
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id"),
        "responses" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "submitted_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- aftercare_templates (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."aftercare_templates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "content" text NOT NULL,
        "product_recommendations" text,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- service_aftercare_assignments (FKs: services, aftercare_templates)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."service_aftercare_assignments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "aftercare_template_id" uuid NOT NULL REFERENCES "${schemaName}"."aftercare_templates"("id") ON DELETE CASCADE,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "service_aftercare_assignment_unique" UNIQUE("service_id", "aftercare_template_id")
      )
    `));

    // -- sms_consent (FK: clients)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."sms_consent" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id") ON DELETE CASCADE,
        "phone" text NOT NULL,
        "consented_at" timestamp with time zone,
        "opted_out_at" timestamp with time zone,
        "consent_method" text NOT NULL,
        "consent_source" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- sms_messages (FKs: appointments, clients)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."sms_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "appointment_id" uuid REFERENCES "${schemaName}"."appointments"("id"),
        "client_id" uuid REFERENCES "${schemaName}"."clients"("id"),
        "to_phone" text NOT NULL,
        "body" text NOT NULL,
        "message_sid" text,
        "status" text DEFAULT 'queued' NOT NULL,
        "error_code" text,
        "error_message" text,
        "message_type" text DEFAULT 'reminder' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- branding_settings (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."branding_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "primary_color" text DEFAULT '#6b8f3c',
        "accent_color" text DEFAULT '#d4c9a8',
        "logo_url" text,
        "font_preference" text DEFAULT 'system',
        "show_powered_by" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- task_catalog (no FKs)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."task_catalog" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "default_duration_minutes" integer NOT NULL,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // -- assistant_tasks (FKs: appointments, stylists, task_catalog)
    await tx.execute(sql.raw(`
      CREATE TABLE "${schemaName}"."assistant_tasks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "appointment_id" uuid NOT NULL REFERENCES "${schemaName}"."appointments"("id") ON DELETE CASCADE,
        "assigned_to" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id"),
        "task_type_id" uuid REFERENCES "${schemaName}"."task_catalog"("id"),
        "task_name" text NOT NULL,
        "during" tstzrange NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `));

    // 4. Create indexes

    // clients email/phone unique indexes are created by migration 0026
    // (scoped to non-deleted rows) in the migration loop below; do not add them here.

    // appointments indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "appointments_stylist_status_idx"
        ON "${schemaName}"."appointments" USING btree ("stylist_id", "status")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "appointments_client_id_idx"
        ON "${schemaName}"."appointments" USING btree ("client_id")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "appointments_calendar_sync_status_idx"
        ON "${schemaName}"."appointments" USING btree ("calendar_sync_status")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "appointments_reminder_sent_at_idx"
        ON "${schemaName}"."appointments" USING btree ("reminder_sent_at")
    `));

    // charges indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "charges_appointment_id_idx"
        ON "${schemaName}"."charges" USING btree ("appointment_id")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "charges_client_id_idx"
        ON "${schemaName}"."charges" USING btree ("client_id")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "charges_status_idx"
        ON "${schemaName}"."charges" USING btree ("status")
    `));

    // calendar_connections indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "calendar_connections_stylist_id_idx"
        ON "${schemaName}"."calendar_connections" USING btree ("stylist_id")
    `));
    await tx.execute(sql.raw(`
      CREATE UNIQUE INDEX "calendar_connections_stylist_platform_idx"
        ON "${schemaName}"."calendar_connections" USING btree ("stylist_id", "platform")
    `));

    // external_events indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "external_events_stylist_time_idx"
        ON "${schemaName}"."external_events" USING btree ("stylist_id", "start_time", "end_time")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "external_events_connection_idx"
        ON "${schemaName}"."external_events" USING btree ("connection_id")
    `));

    // sms_consent indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "sms_consent_phone_idx"
        ON "${schemaName}"."sms_consent" USING btree ("phone")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "sms_consent_client_id_idx"
        ON "${schemaName}"."sms_consent" USING btree ("client_id")
    `));

    // sms_messages indexes
    await tx.execute(sql.raw(`
      CREATE UNIQUE INDEX "sms_messages_sid_idx"
        ON "${schemaName}"."sms_messages" USING btree ("message_sid")
        WHERE "message_sid" IS NOT NULL
    `));

    // 5. Appointment overlap constraint is created by migration 0010 in the migration loop below
    // (after location_id exists) — do not add it again here.

    // 6. Create exclusion constraint for assistant task overlap prevention
    await tx.execute(sql.raw(`
      ALTER TABLE "${schemaName}"."assistant_tasks"
        ADD CONSTRAINT "assistant_tasks_no_overlap"
        EXCLUDE USING gist (
          assigned_to WITH =,
          during WITH &&
        )
        WHERE (status != 'cancelled')
    `));

    // assistant_tasks indexes
    await tx.execute(sql.raw(`
      CREATE INDEX "assistant_tasks_appointment_idx"
        ON "${schemaName}"."assistant_tasks" USING btree ("appointment_id")
    `));
    await tx.execute(sql.raw(`
      CREATE INDEX "assistant_tasks_assigned_to_idx"
        ON "${schemaName}"."assistant_tasks" USING btree ("assigned_to")
    `));

    // Apply every registry migration above the baseline version so newly
    // provisioned tenants match the latest schema. The list comes from the
    // registry, so new migrations apply here with no edit to this file.
    const pendingMigrations = getMigrationsAfterBaseline().filter(
      (m) => data.throughVersion === undefined || m.version <= data.throughVersion,
    );
    for (const migration of pendingMigrations) {
      for (const statement of migration.up(schemaName)) {
        await tx.execute(statement);
      }
    }
    const appliedVersion =
      pendingMigrations.length > 0
        ? pendingMigrations[pendingMigrations.length - 1].version
        : TENANT_BASELINE_VERSION;

    const registry = {
      name: data.name,
      slug: data.slug,
      timezone: data.timezone ?? "America/New_York",
      schemaVersion: appliedVersion,
      industry: "hair_salon" as const,
      modules: [...hairSalon.modules],
      dbShard: shardName,
    };

    if (shardName === "primary") {
      const [tenant] = await tx
        .insert(tenants)
        .values(registry)
        .onConflictDoUpdate({
          target: tenants.slug,
          set: {
            schemaVersion: appliedVersion,
            dbShard: shardName,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { kind: "primary" as const, id: tenant.id };
    }

    return { kind: "shard" as const, appliedVersion };
  });

  if (result.kind === "primary") {
    return { tenantId: result.id, schemaName };
  }

  const [tenant] = await publicDb
    .insert(tenants)
    .values({
      name: data.name,
      slug: data.slug,
      timezone: data.timezone ?? "America/New_York",
      schemaVersion: result.appliedVersion,
      industry: "hair_salon",
      modules: [...hairSalon.modules],
      dbShard: shardName,
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: {
        schemaVersion: result.appliedVersion,
        dbShard: shardName,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    tenantId: tenant.id,
    schemaName,
  };
}

/**
 * Drops a tenant schema and removes the tenant registry entry.
 * USE WITH EXTREME CAUTION. Primarily for test cleanup.
 */
export async function dropTenantSchema(slug: string): Promise<void> {
  slugSchema.parse(slug);
  const schemaName = `tenant_${slug}`;
  const shard = await getShardForSlug(slug);

  if (shard === "primary") {
    await publicDb.transaction(async (tx) => {
      await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await tx.delete(tenants).where(sql`slug = ${slug}`);
    });
    return;
  }

  await getShardClient(shard).db.execute(
    sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`),
  );
  await publicDb.delete(tenants).where(sql`slug = ${slug}`);
}
