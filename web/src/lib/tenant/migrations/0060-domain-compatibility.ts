import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

type ViewColumn = readonly [source: string, exposed: string];

/**
 * The complete relation/column surface present at tenant schema version 39.
 * Keep these lists explicit: version-60 compatibility views intentionally do
 * not expose post-39 columns or duplicate the new and old spellings.
 */
const LEGACY_VIEWS: ReadonlyArray<{
  name: string;
  base: string;
  columns: ReadonlyArray<ViewColumn>;
}> = [
  {
    name: "stylists",
    base: "staff",
    columns: [
      ["id", "id"],
      ["user_id", "user_id"],
      ["email", "email"],
      ["display_name", "display_name"],
      ["photo_url", "photo_url"],
      ["bio", "bio"],
      ["legacy_stylist_role", "role"],
      ["is_active", "is_active"],
      ["created_at", "created_at"],
      ["updated_at", "updated_at"],
      ["default_assistant_id", "default_assistant_id"],
      ["phone", "phone"],
      ["target_hours_per_week", "target_hours_per_week"],
      ["target_hourly_earnings_cents", "target_hourly_earnings_cents"],
    ],
  },
  {
    name: "stylist_services",
    base: "staff_services",
    columns: [
      ["id", "id"],
      ["staff_id", "stylist_id"],
      ["service_id", "service_id"],
      ["created_at", "created_at"],
      ["price_cents", "price_cents"],
      ["duration_minutes", "duration_minutes"],
      ["active_minutes", "active_minutes"],
      ["processing_minutes", "processing_minutes"],
      ["custom_name", "custom_name"],
      ["is_offered", "is_offered"],
      ["updated_at", "updated_at"],
    ],
  },
  {
    name: "salon_policies",
    base: "business_settings",
    columns: [
      ["id", "id"],
      ["timezone", "timezone"],
      ["cancellation_window_hours", "cancellation_window_hours"],
      ["cancellation_fee_percent", "cancellation_fee_percent"],
      ["no_show_fee_percent", "no_show_fee_percent"],
      ["require_card_on_file", "require_card_on_file"],
      ["confirmation_enabled", "confirmation_enabled"],
      ["reminder_enabled", "reminder_enabled"],
      ["reminder_hours_before", "reminder_hours_before"],
      ["confirmation_greeting", "confirmation_greeting"],
      ["confirmation_body", "confirmation_body"],
      ["reminder_greeting", "reminder_greeting"],
      ["reminder_body", "reminder_body"],
      ["business_address", "salon_address"],
      ["apple_pay_enabled", "apple_pay_enabled"],
      ["google_pay_enabled", "google_pay_enabled"],
      ["afterpay_enabled", "afterpay_enabled"],
      ["cashapp_enabled", "cashapp_enabled"],
      ["sms_reminders_enabled", "sms_reminders_enabled"],
      ["sms_reminder_hours_before", "sms_reminder_hours_before"],
      ["sms_reminder_body", "sms_reminder_body"],
      ["created_at", "created_at"],
      ["updated_at", "updated_at"],
      ["sms_confirmation_enabled", "sms_confirmation_enabled"],
      ["sms_confirmation_body", "sms_confirmation_body"],
      ["sms_aftercare_enabled", "sms_aftercare_enabled"],
      ["sms_form_requests_enabled", "sms_form_requests_enabled"],
      ["reminder_hours_before_2", "reminder_hours_before_2"],
      ["sms_reminder_hours_before_2", "sms_reminder_hours_before_2"],
      ["policy_text", "policy_text"],
      ["sms_intake_requests_enabled", "sms_intake_requests_enabled"],
      ["online_booking_audience", "online_booking_audience"],
      ["deposit_enabled", "deposit_enabled"],
      ["deposit_default_type", "deposit_default_type"],
      ["deposit_default_amount", "deposit_default_amount"],
      ["deposit_duration_threshold_minutes", "deposit_duration_threshold_minutes"],
      ["stored_value_expiry_months", "beauty_bank_expiry_months"],
      ["retail_tax_bps", "retail_tax_bps"],
      ["retail_ship_flat_cents", "retail_ship_flat_cents"],
      ["monthly_revenue_goal_cents", "monthly_revenue_goal_cents"],
    ],
  },
  {
    name: "beauty_bank_transactions",
    base: "stored_value_transactions",
    columns: [
      ["id", "id"],
      ["client_id", "client_id"],
      ["type", "type"],
      ["amount_cents", "amount_cents"],
      ["running_balance_cents", "running_balance_cents"],
      ["reference_id", "reference_id"],
      ["counterparty_client_id", "counterparty_client_id"],
      ["note", "note"],
      ["created_at", "created_at"],
      ["created_by", "created_by"],
    ],
  },
  {
    name: "beauty_bank_balances",
    base: "stored_value_balances",
    columns: [
      ["client_id", "client_id"],
      ["balance_cents", "balance_cents"],
      ["updated_at", "updated_at"],
    ],
  },
];

const STAFF_ID_ALIAS_TABLES = [
  "appointments",
  "working_hours",
  "calendar_connections",
  "external_events",
  "time_blocks",
] as const;

const ROLE_FUNCTION = "domain_compat_sync_staff_role_0060";
const STAFF_ID_FUNCTION = "domain_compat_sync_staff_id_0060";
const STORED_VALUE_FUNCTION = "domain_compat_sync_stored_value_cents_0060";

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function relation(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function validateSchemaName(schema: string): void {
  const prefix = "tenant_";
  const suffix = schema.startsWith(prefix) ? schema.slice(prefix.length) : "";
  // This is an SQL-identifier boundary, not fresh-signup slug policy: older
  // tenants with currently reserved names must remain migratable.
  if (
    schema.length > 63 ||
    suffix.length === 0 ||
    !/^[a-z0-9_-]+$/.test(suffix) ||
    schema !== schema.trim()
  ) {
    throw new Error(
      "0060 requires a tenant_ schema name with a safe ASCII suffix no longer than 63 characters",
    );
  }
}

function atomicBlock(statements: readonly string[]): SQL {
  const body = statements
    .map((statement) => `    EXECUTE ${quoteLiteral(statement)};`)
    .join("\n");
  let delimiterIndex = 0;
  let delimiter: string;
  do {
    delimiter = `$domain_compat_atomic_${delimiterIndex}$`;
    delimiterIndex++;
  } while (body.includes(delimiter));

  return sql.raw(`DO ${delimiter}\nBEGIN\n${body}\nEND\n${delimiter};`);
}

function preflight(schema: string): string {
  const requiredTables = [
    "staff",
    "staff_services",
    "business_settings",
    "stored_value_transactions",
    "stored_value_balances",
    ...STAFF_ID_ALIAS_TABLES,
    "charges",
  ];
  const sourceColumns = LEGACY_VIEWS.flatMap(({ base, columns }) =>
    columns
      .filter(([source]) => source !== "legacy_stylist_role")
      .map(([source]) => [base, source] as const),
  );
  const requiredRelations = requiredTables
    .map((name) => `('${name}')`)
    .join(",\n      ");
  const requiredColumns = sourceColumns
    .map(([table, column]) => `('${table}', '${column}')`)
    .join(",\n      ");
  const legacyRelations = LEGACY_VIEWS.map(({ name }) => `('${name}')`).join(", ");
  const aliasColumns = [
    ...STAFF_ID_ALIAS_TABLES.map((table) => [table, "stylist_id"] as const),
    ["charges", "beauty_bank_cents"] as const,
    ["staff", "legacy_stylist_role"] as const,
  ];
  const forbiddenColumns = aliasColumns
    .map(([table, column]) => `('${table}', '${column}')`)
    .join(",\n      ");
  const triggerNames = [
    "appointments",
    "working_hours",
    "calendar_connections",
    "external_events",
    "time_blocks",
    "charges",
    "staff",
  ]
    .map((table) => `('${table}', 'domain_compat_sync_0060')`)
    .join(",\n      ");
  const functionNames = [ROLE_FUNCTION, STAFF_ID_FUNCTION, STORED_VALUE_FUNCTION]
    .map((name) => `'${name}'`)
    .join(", ");

  return `
    DO $domain_compat$
    DECLARE
      v_schema text := ${quoteLiteral(schema)};
      r record;
      v_oid oid;
      v_relkind "char";
      v_type text;
      v_not_null boolean;
      v_default text;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
        RAISE EXCEPTION '0060 expected tenant schema %, which does not exist', v_schema
          USING ERRCODE = '3F000';
      END IF;

      FOR r IN SELECT name FROM (VALUES ${requiredRelations}) AS expected(name)
      LOOP
        SELECT c.oid, c.relkind INTO v_oid, v_relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema AND c.relname = r.name;
        IF v_oid IS NULL THEN
          RAISE EXCEPTION '0060 expected canonical table %.% to exist', v_schema, r.name
            USING ERRCODE = '42P01';
        ELSIF v_relkind <> 'r' THEN
          RAISE EXCEPTION '0060 expected %.% to be an ordinary table, found relkind %', v_schema, r.name, v_relkind
            USING ERRCODE = '42809';
        END IF;
      END LOOP;

      FOR r IN SELECT name FROM (VALUES ${legacyRelations}) AS expected(name)
      LOOP
        IF to_regclass(format('%I.%I', v_schema, r.name)) IS NOT NULL THEN
          RAISE EXCEPTION '0060 legacy relation %.% already exists; refusing to mask it', v_schema, r.name
            USING ERRCODE = '42710';
        END IF;
      END LOOP;

      FOR r IN SELECT table_name, column_name FROM (VALUES ${requiredColumns}) AS expected(table_name, column_name)
      LOOP
        IF NOT EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          WHERE n.nspname = v_schema AND c.relname = r.table_name
            AND a.attname = r.column_name AND a.attnum > 0 AND NOT a.attisdropped
        ) THEN
          RAISE EXCEPTION '0060 expected canonical column %.%.% to exist', v_schema, r.table_name, r.column_name
            USING ERRCODE = '42703';
        END IF;
      END LOOP;

      FOR r IN SELECT table_name, column_name FROM (VALUES ${forbiddenColumns}) AS expected(table_name, column_name)
      LOOP
        IF EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
          WHERE n.nspname = v_schema AND c.relname = r.table_name
            AND a.attname = r.column_name AND a.attnum > 0 AND NOT a.attisdropped
        ) THEN
          RAISE EXCEPTION '0060 compatibility column %.%.% already exists; refusing to overwrite it', v_schema, r.table_name, r.column_name
            USING ERRCODE = '42710';
        END IF;
      END LOOP;

      FOR r IN SELECT table_name FROM (VALUES
        ${STAFF_ID_ALIAS_TABLES.map((table) => `('${table}')`).join(",\n        ")}
      ) AS expected(table_name)
      LOOP
        SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
        INTO v_type, v_not_null, v_default
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'staff_id'
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = v_schema AND c.relname = r.table_name;
        IF v_type IS DISTINCT FROM 'uuid' OR v_not_null IS DISTINCT FROM true OR v_default IS NOT NULL THEN
          RAISE EXCEPTION '0060 expected %.%.staff_id to remain uuid NOT NULL with no default', v_schema, r.table_name
            USING ERRCODE = '42804';
        END IF;
      END LOOP;

      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      INTO v_type, v_not_null, v_default
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'stored_value_cents'
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = v_schema AND c.relname = 'charges';
      IF v_type IS DISTINCT FROM 'integer' OR v_not_null IS DISTINCT FROM false OR v_default IS NOT NULL THEN
        RAISE EXCEPTION '0060 expected %.charges.stored_value_cents to remain integer nullable with no default', v_schema
          USING ERRCODE = '42804';
      END IF;

      SELECT a.atttypid::regtype::text, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      INTO v_type, v_not_null, v_default
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'role'
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = v_schema AND c.relname = 'staff';
      IF v_type IS DISTINCT FROM 'text' OR v_not_null IS DISTINCT FROM true
        OR v_default IS DISTINCT FROM '''provider''::text' THEN
        RAISE EXCEPTION '0060 expected %.staff.role to be text NOT NULL DEFAULT provider', v_schema
          USING ERRCODE = '42804';
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = v_schema AND p.proname IN (${functionNames})
      ) THEN
        RAISE EXCEPTION '0060 compatibility function name already exists in schema %', v_schema
          USING ERRCODE = '42710';
      END IF;

      FOR r IN SELECT table_name, trigger_name FROM (VALUES ${triggerNames}) AS expected(table_name, trigger_name)
      LOOP
        IF EXISTS (
          SELECT 1 FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = v_schema AND c.relname = r.table_name AND t.tgname = r.trigger_name
        ) THEN
          RAISE EXCEPTION '0060 compatibility trigger %.% already exists', r.table_name, r.trigger_name
            USING ERRCODE = '42710';
        END IF;
      END LOOP;
    END
    $domain_compat$;
  `;
}

function createStaffIdFunction(schema: string): string {
  return `
    CREATE FUNCTION ${relation(schema, STAFF_ID_FUNCTION)}()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $domain_compat$
    DECLARE
      canonical_changed boolean;
      legacy_changed boolean;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.staff_id IS NULL THEN
          NEW.staff_id := NEW.stylist_id;
        ELSIF NEW.stylist_id IS NULL THEN
          NEW.stylist_id := NEW.staff_id;
        ELSIF NEW.staff_id IS DISTINCT FROM NEW.stylist_id THEN
          RAISE EXCEPTION 'staff_id and stylist_id must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      canonical_changed := NEW.staff_id IS DISTINCT FROM OLD.staff_id;
      legacy_changed := NEW.stylist_id IS DISTINCT FROM OLD.stylist_id;
      IF canonical_changed AND legacy_changed THEN
        IF NEW.staff_id IS DISTINCT FROM NEW.stylist_id THEN
          RAISE EXCEPTION 'staff_id and stylist_id must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '23514';
        END IF;
      ELSIF canonical_changed THEN
        NEW.stylist_id := NEW.staff_id;
      ELSIF legacy_changed THEN
        NEW.staff_id := NEW.stylist_id;
      END IF;
      RETURN NEW;
    END
    $domain_compat$;
  `;
}

function createStoredValueFunction(schema: string): string {
  return `
    CREATE FUNCTION ${relation(schema, STORED_VALUE_FUNCTION)}()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $domain_compat$
    DECLARE
      canonical_changed boolean;
      legacy_changed boolean;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.stored_value_cents IS NULL THEN
          NEW.stored_value_cents := NEW.beauty_bank_cents;
        ELSIF NEW.beauty_bank_cents IS NULL THEN
          NEW.beauty_bank_cents := NEW.stored_value_cents;
        ELSIF NEW.stored_value_cents IS DISTINCT FROM NEW.beauty_bank_cents THEN
          RAISE EXCEPTION 'stored_value_cents and beauty_bank_cents must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      canonical_changed := NEW.stored_value_cents IS DISTINCT FROM OLD.stored_value_cents;
      legacy_changed := NEW.beauty_bank_cents IS DISTINCT FROM OLD.beauty_bank_cents;
      IF canonical_changed AND legacy_changed THEN
        IF NEW.stored_value_cents IS DISTINCT FROM NEW.beauty_bank_cents THEN
          RAISE EXCEPTION 'stored_value_cents and beauty_bank_cents must match on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '23514';
        END IF;
      ELSIF canonical_changed THEN
        NEW.beauty_bank_cents := NEW.stored_value_cents;
      ELSIF legacy_changed THEN
        NEW.stored_value_cents := NEW.beauty_bank_cents;
      END IF;
      RETURN NEW;
    END
    $domain_compat$;
  `;
}

function createStaffRoleFunction(schema: string): string {
  return `
    CREATE FUNCTION ${relation(schema, ROLE_FUNCTION)}()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $domain_compat$
    DECLARE
      canonical_changed boolean;
      legacy_changed boolean;
      canonical_role text;
      legacy_role text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        -- NULL is intentional input here: leave it for the column's NOT NULL constraint.
        IF NEW.role IS NULL OR NEW.legacy_stylist_role IS NULL THEN
          RETURN NEW;
        END IF;
        canonical_role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;
        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;

        -- The two defaults are indistinguishable from explicit values in a row trigger.
        -- Treat canonical provider and raw legacy stylist as omitted so the
        -- other domain's non-default value can win. An explicit legacy provider
        -- is non-default and must conflict with a different canonical value.
        IF canonical_role = 'provider' AND NEW.legacy_stylist_role <> 'stylist' THEN
          canonical_role := legacy_role;
        ELSIF NEW.legacy_stylist_role = 'stylist' AND canonical_role <> 'provider' THEN
          legacy_role := canonical_role;
        ELSIF canonical_role IS DISTINCT FROM legacy_role THEN
          RAISE EXCEPTION 'role and legacy_stylist_role must describe the same role'
            USING ERRCODE = '23514';
        END IF;

        NEW.role := canonical_role;
        NEW.legacy_stylist_role := CASE canonical_role WHEN 'provider' THEN 'stylist' ELSE canonical_role END;
        RETURN NEW;
      END IF;

      canonical_changed := NEW.role IS DISTINCT FROM OLD.role;
      legacy_changed := NEW.legacy_stylist_role IS DISTINCT FROM OLD.legacy_stylist_role;
      IF canonical_changed AND legacy_changed THEN
        -- Preserve explicit NULL so the existing NOT NULL constraint rejects it.
        IF NEW.role IS NULL OR NEW.legacy_stylist_role IS NULL THEN
          RETURN NEW;
        END IF;
        canonical_role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;
        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;
        IF canonical_role IS DISTINCT FROM legacy_role THEN
          RAISE EXCEPTION 'role and legacy_stylist_role must describe the same role'
            USING ERRCODE = '23514';
        END IF;
        NEW.role := canonical_role;
        NEW.legacy_stylist_role := CASE canonical_role WHEN 'provider' THEN 'stylist' ELSE canonical_role END;
      ELSIF canonical_changed THEN
        IF NEW.role IS NULL THEN
          RETURN NEW;
        END IF;
        NEW.role := CASE NEW.role WHEN 'stylist' THEN 'provider' ELSE NEW.role END;
        NEW.legacy_stylist_role := CASE NEW.role WHEN 'provider' THEN 'stylist' ELSE NEW.role END;
      ELSIF legacy_changed THEN
        IF NEW.legacy_stylist_role IS NULL THEN
          RETURN NEW;
        END IF;
        legacy_role := CASE NEW.legacy_stylist_role WHEN 'stylist' THEN 'provider' ELSE NEW.legacy_stylist_role END;
        NEW.role := legacy_role;
        NEW.legacy_stylist_role := CASE legacy_role WHEN 'provider' THEN 'stylist' ELSE legacy_role END;
      END IF;
      RETURN NEW;
    END
    $domain_compat$;
  `;
}

export const migration: TenantMigration = {
  version: 60,
  description: "Add forward-compatible legacy domain views and synchronized column aliases",
  up: (schema: string): SQL[] => {
    validateSchemaName(schema);
    return [
      atomicBlock([
        preflight(schema),
        `ALTER TABLE ${relation(schema, "staff")} ADD COLUMN "legacy_stylist_role" text NOT NULL DEFAULT 'stylist'`,
        `UPDATE ${relation(schema, "staff")} SET "legacy_stylist_role" = CASE "role" WHEN 'provider' THEN 'stylist' ELSE "role" END`,
        ...STAFF_ID_ALIAS_TABLES.map(
          (table) => `ALTER TABLE ${relation(schema, table)} ADD COLUMN "stylist_id" uuid`,
        ),
        ...STAFF_ID_ALIAS_TABLES.map(
          (table) => `UPDATE ${relation(schema, table)} SET "stylist_id" = "staff_id"`,
        ),
        `ALTER TABLE ${relation(schema, "charges")} ADD COLUMN "beauty_bank_cents" integer`,
        `UPDATE ${relation(schema, "charges")} SET "beauty_bank_cents" = "stored_value_cents"`,
        createStaffRoleFunction(schema),
        createStaffIdFunction(schema),
        createStoredValueFunction(schema),
        `CREATE TRIGGER "domain_compat_sync_0060" BEFORE INSERT OR UPDATE ON ${relation(schema, "staff")} FOR EACH ROW EXECUTE FUNCTION ${relation(schema, ROLE_FUNCTION)}()`,
        ...STAFF_ID_ALIAS_TABLES.map(
          (table) => `CREATE TRIGGER "domain_compat_sync_0060" BEFORE INSERT OR UPDATE ON ${relation(schema, table)} FOR EACH ROW EXECUTE FUNCTION ${relation(schema, STAFF_ID_FUNCTION)}()`,
        ),
        `CREATE TRIGGER "domain_compat_sync_0060" BEFORE INSERT OR UPDATE ON ${relation(schema, "charges")} FOR EACH ROW EXECUTE FUNCTION ${relation(schema, STORED_VALUE_FUNCTION)}()`,
        ...LEGACY_VIEWS.map(({ name, base, columns }) => {
          const projection = columns
            .map(([source, exposed]) =>
              source === exposed
                ? quoteIdentifier(source)
                : `${quoteIdentifier(source)} AS ${quoteIdentifier(exposed)}`,
            )
            .join(", ");
          return `CREATE VIEW ${relation(schema, name)} WITH (security_invoker = true) AS SELECT ${projection} FROM ${relation(schema, base)}`;
        }),
      ]),
    ];
  },
  down: (schema: string): SQL[] => {
    validateSchemaName(schema);
    return [
      atomicBlock([
        ...LEGACY_VIEWS.map(({ name }) => `DROP VIEW IF EXISTS ${relation(schema, name)}`),
        `DROP TRIGGER IF EXISTS "domain_compat_sync_0060" ON ${relation(schema, "staff")}`,
        ...STAFF_ID_ALIAS_TABLES.map(
          (table) => `DROP TRIGGER IF EXISTS "domain_compat_sync_0060" ON ${relation(schema, table)}`,
        ),
        `DROP TRIGGER IF EXISTS "domain_compat_sync_0060" ON ${relation(schema, "charges")}`,
        `DROP FUNCTION IF EXISTS ${relation(schema, ROLE_FUNCTION)}()`,
        `DROP FUNCTION IF EXISTS ${relation(schema, STAFF_ID_FUNCTION)}()`,
        `DROP FUNCTION IF EXISTS ${relation(schema, STORED_VALUE_FUNCTION)}()`,
        ...STAFF_ID_ALIAS_TABLES.map(
          (table) => `ALTER TABLE ${relation(schema, table)} DROP COLUMN IF EXISTS "stylist_id"`,
        ),
        `ALTER TABLE ${relation(schema, "charges")} DROP COLUMN IF EXISTS "beauty_bank_cents"`,
        `ALTER TABLE ${relation(schema, "staff")} DROP COLUMN IF EXISTS "legacy_stylist_role"`,
      ]),
    ];
  },
};
