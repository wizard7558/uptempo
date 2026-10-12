import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0049 (Phase 3.3): projects, booking windows, consent fields.
 *
 * - projects: multi-session work with one quoted total and a shared deposit credit.
 * - booking_windows + staff.books_mode: when a staff member's books are open.
 * - charges.deposit_applied_cents, quotes.project_sessions, appointments.project_id.
 * - form_templates (kind, min_age, requires_id), form_responses (dob, ID upload, ID check).
 * - business_settings.id_retention_days: how long an uploaded ID photo is kept.
 *
 * Every statement is safe to run again. A column added with IF NOT EXISTS and an
 * inline CONSTRAINT is skipped whole when the column exists, so the constraint
 * name never collides. The one constraint added to an existing column set
 * (form_responses_verified_check) uses a DO block.
 */
export const migration: TenantMigration = {
  version: 49,
  description: "Projects, booking windows, consent fields",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        request_id uuid REFERENCES "${s}".booking_requests(id) ON DELETE SET NULL,
        title text NOT NULL,
        placement text,
        size text,
        status text NOT NULL DEFAULT 'consult',
        est_sessions integer NOT NULL DEFAULT 1,
        quoted_total_cents integer,
        design_attachment_id uuid REFERENCES "${s}".attachments(id) ON DELETE SET NULL,
        design_sent_at timestamptz,
        design_approved_at timestamptz,
        design_approved_name text,
        access_token text NOT NULL,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT projects_status_check CHECK (status IN ('consult','design','scheduled','in_progress','healing','touch_up','complete','cancelled')),
        CONSTRAINT projects_sessions_check CHECK (est_sessions BETWEEN 1 AND 50),
        CONSTRAINT projects_total_check CHECK (quoted_total_cents IS NULL OR quoted_total_cents >= 0),
        CONSTRAINT projects_approval_check CHECK ((design_approved_at IS NULL) = (design_approved_name IS NULL)),
        CONSTRAINT projects_access_token_unique UNIQUE (access_token)
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS projects_client_idx ON "${s}".projects (client_id)
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS projects_status_idx ON "${s}".projects (status, updated_at DESC)
    `),
    sql.raw(`
      ALTER TABLE "${s}".appointments ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES "${s}".projects(id) ON DELETE SET NULL
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_project_idx ON "${s}".appointments (project_id) WHERE project_id IS NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${s}".charges ADD COLUMN IF NOT EXISTS deposit_applied_cents integer NOT NULL DEFAULT 0
        CONSTRAINT charges_deposit_applied_check CHECK (deposit_applied_cents >= 0)
    `),
    sql.raw(`
      ALTER TABLE "${s}".quotes ADD COLUMN IF NOT EXISTS project_sessions integer
        CONSTRAINT quotes_project_sessions_check CHECK (project_sessions IS NULL OR project_sessions BETWEEN 1 AND 50)
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".booking_windows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        opens_at timestamptz NOT NULL,
        closes_at timestamptz NOT NULL,
        mode text NOT NULL DEFAULT 'requests',
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT booking_windows_mode_check CHECK (mode IN ('requests','direct')),
        CONSTRAINT booking_windows_range_check CHECK (closes_at > opens_at)
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS booking_windows_staff_closes_idx ON "${s}".booking_windows (staff_id, closes_at)
    `),
    sql.raw(`
      ALTER TABLE "${s}".staff ADD COLUMN IF NOT EXISTS books_mode text NOT NULL DEFAULT 'open'
        CONSTRAINT staff_books_mode_check CHECK (books_mode IN ('open','windows','closed'))
    `),
    sql.raw(`
      ALTER TABLE "${s}".form_templates
        ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'intake' CONSTRAINT form_templates_kind_check CHECK (kind IN ('intake','waiver','consent','health_history','par_q')),
        ADD COLUMN IF NOT EXISTS min_age integer CONSTRAINT form_templates_min_age_check CHECK (min_age IS NULL OR min_age BETWEEN 13 AND 99),
        ADD COLUMN IF NOT EXISTS requires_id integer NOT NULL DEFAULT 0 CONSTRAINT form_templates_requires_id_check CHECK (requires_id IN (0,1))
    `),
    sql.raw(`
      ALTER TABLE "${s}".form_responses
        ADD COLUMN IF NOT EXISTS dob date,
        ADD COLUMN IF NOT EXISTS id_attachment_id uuid REFERENCES "${s}".attachments(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS verified_by text,
        ADD COLUMN IF NOT EXISTS verified_at timestamptz
    `),
    sql.raw(`
      DO $do$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_responses_verified_check' AND connamespace = '"${s}"'::regnamespace) THEN
          ALTER TABLE "${s}".form_responses ADD CONSTRAINT form_responses_verified_check CHECK ((verified_by IS NULL) = (verified_at IS NULL));
        END IF;
      END $do$
    `),
    sql.raw(`
      ALTER TABLE "${s}".business_settings ADD COLUMN IF NOT EXISTS id_retention_days integer NOT NULL DEFAULT 365
        CONSTRAINT business_settings_id_retention_check CHECK (id_retention_days IN (30,90,180,365,730))
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}".business_settings DROP COLUMN IF EXISTS id_retention_days`),
    sql.raw(`ALTER TABLE "${s}".form_responses DROP CONSTRAINT IF EXISTS form_responses_verified_check`),
    sql.raw(`
      ALTER TABLE "${s}".form_responses
        DROP COLUMN IF EXISTS verified_at,
        DROP COLUMN IF EXISTS verified_by,
        DROP COLUMN IF EXISTS id_attachment_id,
        DROP COLUMN IF EXISTS dob
    `),
    sql.raw(`
      ALTER TABLE "${s}".form_templates
        DROP COLUMN IF EXISTS requires_id,
        DROP COLUMN IF EXISTS min_age,
        DROP COLUMN IF EXISTS kind
    `),
    sql.raw(`ALTER TABLE "${s}".staff DROP COLUMN IF EXISTS books_mode`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".booking_windows`),
    sql.raw(`ALTER TABLE "${s}".quotes DROP COLUMN IF EXISTS project_sessions`),
    sql.raw(`ALTER TABLE "${s}".charges DROP COLUMN IF EXISTS deposit_applied_cents`),
    sql.raw(`DROP INDEX IF EXISTS "${s}".appointments_project_idx`),
    sql.raw(`ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS project_id`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".projects`),
  ],
};
