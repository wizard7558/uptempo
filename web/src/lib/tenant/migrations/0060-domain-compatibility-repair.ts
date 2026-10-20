import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

export type DomainCompatibilityState = "present" | "missing" | "partial" | "blocked";

export interface DomainCompatibilityInspection {
  state: DomainCompatibilityState;
  objects: string[];
  reasons: string[];
}

export interface CatalogExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface DomainCompatibilitySnapshot {
  relations: Array<{
    name: string;
    kind: string;
    options: string[];
    definition: string | null;
  }>;
  columns: Array<{
    table: string;
    name: string;
    dataType: string;
    notNull: boolean;
    defaultExpression: string | null;
    generated: string;
    identity: string;
    position: number;
  }>;
  viewMetadata: Array<{
    name: string;
    updatable: boolean;
    insertable: boolean;
  }>;
  functions: Array<{
    name: string;
    kind: string;
    identityArguments: string;
    returnType: string;
    language: string;
    securityDefiner: boolean;
    isStrict: boolean;
    volatility: string;
    parallel: string;
    leakproof: boolean;
    config: string[];
    source: string;
    returnsSet: boolean;
  }>;
  triggers: Array<{
    name: string;
    table: string;
    functionName: string;
    functionSchema: string;
    enabled: string;
    type: number;
    argumentCount: number;
    condition: string | null;
    definition: string;
  }>;
  dataMismatches: Record<string, number>;
}

type ViewSpec = {
  name: string;
  base: string;
  columns: ReadonlyArray<readonly [source: string, exposed: string]>;
};

const VIEW_SPECS: readonly ViewSpec[] = [
  {
    name: "stylists",
    base: "staff",
    columns: [
      ["id", "id"], ["user_id", "user_id"], ["email", "email"],
      ["display_name", "display_name"], ["photo_url", "photo_url"], ["bio", "bio"],
      ["legacy_stylist_role", "role"], ["is_active", "is_active"],
      ["created_at", "created_at"], ["updated_at", "updated_at"],
      ["default_assistant_id", "default_assistant_id"], ["phone", "phone"],
      ["target_hours_per_week", "target_hours_per_week"],
      ["target_hourly_earnings_cents", "target_hourly_earnings_cents"],
    ],
  },
  {
    name: "stylist_services",
    base: "staff_services",
    columns: [
      ["id", "id"], ["staff_id", "stylist_id"], ["service_id", "service_id"],
      ["created_at", "created_at"], ["price_cents", "price_cents"],
      ["duration_minutes", "duration_minutes"], ["active_minutes", "active_minutes"],
      ["processing_minutes", "processing_minutes"], ["custom_name", "custom_name"],
      ["is_offered", "is_offered"], ["updated_at", "updated_at"],
    ],
  },
  {
    name: "salon_policies",
    base: "business_settings",
    columns: [
      ["id", "id"], ["timezone", "timezone"],
      ["cancellation_window_hours", "cancellation_window_hours"],
      ["cancellation_fee_percent", "cancellation_fee_percent"],
      ["no_show_fee_percent", "no_show_fee_percent"], ["require_card_on_file", "require_card_on_file"],
      ["confirmation_enabled", "confirmation_enabled"], ["reminder_enabled", "reminder_enabled"],
      ["reminder_hours_before", "reminder_hours_before"], ["confirmation_greeting", "confirmation_greeting"],
      ["confirmation_body", "confirmation_body"], ["reminder_greeting", "reminder_greeting"],
      ["reminder_body", "reminder_body"], ["business_address", "salon_address"],
      ["apple_pay_enabled", "apple_pay_enabled"], ["google_pay_enabled", "google_pay_enabled"],
      ["afterpay_enabled", "afterpay_enabled"], ["cashapp_enabled", "cashapp_enabled"],
      ["sms_reminders_enabled", "sms_reminders_enabled"],
      ["sms_reminder_hours_before", "sms_reminder_hours_before"],
      ["sms_reminder_body", "sms_reminder_body"], ["created_at", "created_at"],
      ["updated_at", "updated_at"], ["sms_confirmation_enabled", "sms_confirmation_enabled"],
      ["sms_confirmation_body", "sms_confirmation_body"], ["sms_aftercare_enabled", "sms_aftercare_enabled"],
      ["sms_form_requests_enabled", "sms_form_requests_enabled"],
      ["reminder_hours_before_2", "reminder_hours_before_2"],
      ["sms_reminder_hours_before_2", "sms_reminder_hours_before_2"],
      ["policy_text", "policy_text"], ["sms_intake_requests_enabled", "sms_intake_requests_enabled"],
      ["online_booking_audience", "online_booking_audience"], ["deposit_enabled", "deposit_enabled"],
      ["deposit_default_type", "deposit_default_type"], ["deposit_default_amount", "deposit_default_amount"],
      ["deposit_duration_threshold_minutes", "deposit_duration_threshold_minutes"],
      ["stored_value_expiry_months", "beauty_bank_expiry_months"], ["retail_tax_bps", "retail_tax_bps"],
      ["retail_ship_flat_cents", "retail_ship_flat_cents"],
      ["monthly_revenue_goal_cents", "monthly_revenue_goal_cents"],
    ],
  },
  {
    name: "beauty_bank_transactions",
    base: "stored_value_transactions",
    columns: [
      ["id", "id"], ["client_id", "client_id"], ["type", "type"],
      ["amount_cents", "amount_cents"], ["running_balance_cents", "running_balance_cents"],
      ["reference_id", "reference_id"], ["counterparty_client_id", "counterparty_client_id"],
      ["note", "note"], ["created_at", "created_at"], ["created_by", "created_by"],
    ],
  },
  {
    name: "beauty_bank_balances",
    base: "stored_value_balances",
    columns: [["client_id", "client_id"], ["balance_cents", "balance_cents"], ["updated_at", "updated_at"]],
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
const TRIGGER_NAME = "domain_compat_sync_0060";
const MAX_DETAILS = 24;

const BASE_TABLES = [
  "staff",
  "staff_services",
  "business_settings",
  "stored_value_transactions",
  "stored_value_balances",
  ...STAFF_ID_ALIAS_TABLES,
  "charges",
] as const;

const ROLE_SOURCE_SHA256 = "9c05be73e5fc9069205201d4e270ba5e1b4e7034a395ab8f6bae75f0fd367022";
const STAFF_ID_SOURCE_SHA256 = "cf35b19c21364483dcce876ded578b66e4eb228debd6d6a55d26c2eceb5a3b7a";
const STORED_VALUE_SOURCE_SHA256 = "a203b569cda7f05e03a3834078895b9e390c77d19282a89bbd10ab279f826ce2";

/** Stable expectations mirrored from migration 0060; the integration test verifies parity. */
export const DOMAIN_COMPATIBILITY_EXPECTATIONS = {
  views: VIEW_SPECS,
  staffIdAliasTables: STAFF_ID_ALIAS_TABLES,
  roleFunction: ROLE_FUNCTION,
  staffIdFunction: STAFF_ID_FUNCTION,
  storedValueFunction: STORED_VALUE_FUNCTION,
  triggerName: TRIGGER_NAME,
  functionSourceHashes: {
    [ROLE_FUNCTION]: ROLE_SOURCE_SHA256,
    [STAFF_ID_FUNCTION]: STAFF_ID_SOURCE_SHA256,
    [STORED_VALUE_FUNCTION]: STORED_VALUE_SOURCE_SHA256,
  },
} as const;

const RELATION_NAMES = [...new Set([...BASE_TABLES, ...VIEW_SPECS.map((view) => view.name)])];
const FUNCTION_NAMES = [ROLE_FUNCTION, STAFF_ID_FUNCTION, STORED_VALUE_FUNCTION];
const SOURCE_COLUMNS = VIEW_SPECS.flatMap(({ base, columns }) =>
  columns
    .filter(([source]) => source !== "legacy_stylist_role")
    .map(([source]) => `${base}.${source}`),
);
const ALIAS_COLUMNS = [
  ...STAFF_ID_ALIAS_TABLES.map((table) => ({ table, name: "stylist_id", type: "uuid", notNull: false })),
  { table: "charges", name: "beauty_bank_cents", type: "integer", notNull: false },
  { table: "staff", name: "legacy_stylist_role", type: "text", notNull: true },
] as const;
const TRIGGER_TARGETS = [
  ...STAFF_ID_ALIAS_TABLES.map((table) => ({ table, functionName: STAFF_ID_FUNCTION })),
  { table: "charges", functionName: STORED_VALUE_FUNCTION },
  { table: "staff", functionName: ROLE_FUNCTION },
] as const;

function safeSchemaName(schema: string): boolean {
  return /^tenant_[a-z0-9_-]+$/.test(schema) && schema.length <= 63;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function queryRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
    if (Symbol.iterator in result) return Array.from(result as Iterable<Record<string, unknown>>);
  }
  return [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "t" || value === "YES" || value === "yes";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue);
  if (typeof value !== "string" || value === "{}" || value === "") return [];
  if (value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").filter(Boolean).map((item) => item.replace(/^"|"$/g, ""));
  }
  return [value];
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Tokenizes SQL while preserving string values and quoted identifier case. */
function sqlTokens(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else index++;
      }
      continue;
    }
    if (character === "'") {
      let token = "'";
      index++;
      while (index < source.length) {
        const current = source[index++];
        token += current;
        if (current === "'") {
          if (source[index] === "'") token += source[index++];
          else break;
        }
      }
      tokens.push(token);
      continue;
    }
    if (character === '"') {
      let identifier = "";
      index++;
      while (index < source.length) {
        const current = source[index++];
        if (current === '"') {
          if (source[index] === '"') {
            identifier += '"';
            index++;
          } else break;
        } else identifier += current;
      }
      tokens.push(identifier === identifier.toLowerCase() ? identifier : `@quoted:${identifier}`);
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(index));
    if (word) {
      tokens.push(word[0].toLowerCase());
      index += word[0].length;
      continue;
    }
    const operator = /^(::|:=|<>|!=|<=|>=|\|\||->>|->|#>>|#>)/.exec(source.slice(index));
    if (operator) {
      tokens.push(operator[0]);
      index += operator[0].length;
      continue;
    }
    tokens.push(character);
    index++;
  }
  if (tokens.at(-1) === ";") tokens.pop();
  return tokens;
}

function unqualifySchema(tokens: string[], schema: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === schema && tokens[index + 1] === ".") {
      index++;
      continue;
    }
    result.push(tokens[index]);
  }
  return result;
}

function normalizedSql(source: string, schema?: string): string {
  const tokens = sqlTokens(source);
  return (schema ? unqualifySchema(tokens, schema) : tokens).join("\u001f");
}

function sourceHash(source: string): string {
  return createHash("sha256").update(normalizedSql(source)).digest("hex");
}

function sqlArray(values: readonly string[]) {
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

async function collectSnapshot(
  executor: CatalogExecutor,
  schema: string,
): Promise<DomainCompatibilitySnapshot> {
  const relationRows = queryRows(
    await executor.execute(sql`
      SELECT c.relname AS name, c.relkind::text AS kind,
             COALESCE(c.reloptions, ARRAY[]::text[]) AS options,
             CASE WHEN c.relkind = 'v' THEN pg_get_viewdef(c.oid, true) ELSE NULL END AS definition
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = ANY(${sqlArray(RELATION_NAMES)})
    `),
  );
  const columnRows = queryRows(
    await executor.execute(sql`
      SELECT c.relname AS table_name, a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type, a.attnotnull AS not_null,
             pg_get_expr(d.adbin, d.adrelid) AS default_expression,
             a.attgenerated AS generated, a.attidentity AS identity, a.attnum AS position
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = ${schema} AND c.relname = ANY(${sqlArray(RELATION_NAMES)})
        AND a.attnum > 0 AND NOT a.attisdropped
    `),
  );
  const viewRows = queryRows(
    await executor.execute(sql`
      SELECT table_name AS name, is_updatable, is_insertable_into
      FROM information_schema.views
      WHERE table_schema = ${schema} AND table_name = ANY(${sqlArray(VIEW_SPECS.map((view) => view.name))})
    `),
  );
  const functionRows = queryRows(
    await executor.execute(sql`
      SELECT p.proname AS name, p.prokind AS kind,
             pg_get_function_identity_arguments(p.oid) AS identity_arguments,
             p.prorettype::regtype::text AS return_type, l.lanname AS language,
             p.prosecdef AS security_definer, p.proisstrict AS is_strict,
             p.provolatile AS volatility, p.proparallel AS parallel, p.proleakproof AS leakproof,
             COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
             p.prosrc AS source, p.proretset AS returns_set
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = ${schema} AND p.proname = ANY(${sqlArray(FUNCTION_NAMES)})
    `),
  );
  const triggerRows = queryRows(
    await executor.execute(sql`
      SELECT t.tgname AS name, c.relname AS table_name, p.proname AS function_name,
             pn.nspname AS function_schema, t.tgenabled AS enabled, t.tgtype AS trigger_type,
             t.tgnargs AS argument_count, pg_get_expr(t.tgqual, t.tgrelid) AS condition,
             pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE n.nspname = ${schema} AND t.tgname = ${TRIGGER_NAME}
    `),
  );

  const relationMap = new Map(relationRows.map((row) => [stringValue(row.name), row]));
  const columnKeys = new Set(columnRows.map((row) => `${stringValue(row.table_name)}.${stringValue(row.column_name)}`));
  const dataMismatches: Record<string, number> = {};
  const aggregatePairs = [
    ...STAFF_ID_ALIAS_TABLES.map((table) => ({
      table,
      canonical: "staff_id",
      alias: "stylist_id",
      key: `${table}.stylist_id`,
      predicate: `"stylist_id" IS DISTINCT FROM "staff_id"`,
    })),
    {
      table: "charges",
      canonical: "stored_value_cents",
      alias: "beauty_bank_cents",
      key: "charges.beauty_bank_cents",
      predicate: `"beauty_bank_cents" IS DISTINCT FROM "stored_value_cents"`,
    },
    {
      table: "staff",
      canonical: "role",
      alias: "legacy_stylist_role",
      key: "staff.legacy_stylist_role",
      predicate: `"legacy_stylist_role" IS DISTINCT FROM CASE "role" WHEN 'provider' THEN 'stylist' ELSE "role" END`,
    },
  ];
  for (const pair of aggregatePairs) {
    const relation = relationMap.get(pair.table);
    const tableIsOrdinary = stringValue(relation?.kind) === "r";
    if (
      tableIsOrdinary &&
      columnKeys.has(`${pair.table}.${pair.canonical}`) &&
      columnKeys.has(`${pair.table}.${pair.alias}`)
    ) {
      const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(pair.table)}`;
      const aggregate = queryRows(await executor.execute(sql`
        SELECT count(*)::bigint AS mismatch_count
        FROM ${sql.raw(qualified)}
        WHERE ${sql.raw(pair.predicate)}
      `));
      dataMismatches[pair.key] = numberValue(aggregate[0]?.mismatch_count);
    }
  }

  return {
    relations: relationRows.map((row) => ({
      name: stringValue(row.name),
      kind: stringValue(row.kind),
      options: stringArray(row.options),
      definition: row.definition == null ? null : stringValue(row.definition),
    })),
    columns: columnRows.map((row) => ({
      table: stringValue(row.table_name),
      name: stringValue(row.column_name),
      dataType: stringValue(row.data_type),
      notNull: booleanValue(row.not_null),
      defaultExpression: row.default_expression == null ? null : stringValue(row.default_expression),
      generated: stringValue(row.generated),
      identity: stringValue(row.identity),
      position: numberValue(row.position),
    })),
    viewMetadata: viewRows.map((row) => ({
      name: stringValue(row.name),
      updatable: booleanValue(row.is_updatable),
      insertable: booleanValue(row.is_insertable_into),
    })),
    functions: functionRows.map((row) => ({
      name: stringValue(row.name),
      kind: stringValue(row.kind),
      identityArguments: stringValue(row.identity_arguments),
      returnType: stringValue(row.return_type),
      language: stringValue(row.language),
      securityDefiner: booleanValue(row.security_definer),
      isStrict: booleanValue(row.is_strict),
      volatility: stringValue(row.volatility),
      parallel: stringValue(row.parallel),
      leakproof: booleanValue(row.leakproof),
      config: stringArray(row.config),
      source: stringValue(row.source),
      returnsSet: booleanValue(row.returns_set),
    })),
    triggers: triggerRows.map((row) => ({
      name: stringValue(row.name),
      table: stringValue(row.table_name),
      functionName: stringValue(row.function_name),
      functionSchema: stringValue(row.function_schema),
      enabled: stringValue(row.enabled),
      type: numberValue(row.trigger_type),
      argumentCount: numberValue(row.argument_count),
      condition: row.condition == null ? null : stringValue(row.condition),
      definition: stringValue(row.definition),
    })),
    dataMismatches,
  };
}

function viewDefinition(spec: ViewSpec): string {
  const projection = spec.columns
    .map(([source, exposed]) =>
      source === exposed ? source : `${source} AS ${exposed}`,
    )
    .join(", ");
  return `SELECT ${projection} FROM ${spec.base}`;
}

function column(snapshot: DomainCompatibilitySnapshot, table: string, name: string) {
  return snapshot.columns.find((candidate) => candidate.table === table && candidate.name === name);
}

function relation(snapshot: DomainCompatibilitySnapshot, name: string) {
  return snapshot.relations.find((candidate) => candidate.name === name);
}

function addIssue(objects: string[], reasons: string[], object: string, reason: string) {
  if (!objects.includes(object)) objects.push(object);
  if (!reasons.includes(reason)) reasons.push(reason);
}

function expectedArtifactsPresent(snapshot: DomainCompatibilitySnapshot): boolean {
  for (const view of VIEW_SPECS) if (!relation(snapshot, view.name)) return false;
  for (const alias of ALIAS_COLUMNS) if (!column(snapshot, alias.table, alias.name)) return false;
  for (const name of FUNCTION_NAMES) if (!snapshot.functions.some((fn) => fn.name === name)) return false;
  return TRIGGER_TARGETS.every(({ table }) =>
    snapshot.triggers.some((trigger) => trigger.name === TRIGGER_NAME && trigger.table === table),
  );
}

/** Classifies a catalog snapshot without database access or mutation. */
export function classifyDomainCompatibilitySnapshot(
  snapshot: DomainCompatibilitySnapshot,
  schema: string,
): DomainCompatibilityInspection {
  if (!safeSchemaName(schema)) {
    return { state: "blocked", objects: ["schema"], reasons: ["invalid tenant schema name"] };
  }

  const objects: string[] = [];
  const reasons: string[] = [];
  const artifactObjects = new Set<string>();
  for (const view of VIEW_SPECS) {
    if (relation(snapshot, view.name)) artifactObjects.add(`view ${view.name}`);
  }
  for (const alias of ALIAS_COLUMNS) {
    if (column(snapshot, alias.table, alias.name)) artifactObjects.add(`column ${alias.table}.${alias.name}`);
  }
  for (const name of FUNCTION_NAMES) {
    if (snapshot.functions.some((fn) => fn.name === name)) artifactObjects.add(`function ${name}`);
  }
  if (snapshot.triggers.some((trigger) => trigger.name === TRIGGER_NAME)) {
    artifactObjects.add(`trigger ${TRIGGER_NAME}`);
  }

  const prereqIssues: Array<[string, string]> = [];
  for (const table of BASE_TABLES) {
    if (relation(snapshot, table)?.kind !== "r") {
      prereqIssues.push([`table ${table}`, "canonical ordinary table prerequisite missing or has wrong kind"]);
    }
  }
  for (const key of SOURCE_COLUMNS) {
    const [table, name] = key.split(".");
    if (!column(snapshot, table, name)) {
      prereqIssues.push([`column ${key}`, "canonical view source column missing"]);
    }
  }
  for (const table of STAFF_ID_ALIAS_TABLES) {
    const staffId = column(snapshot, table, "staff_id");
    if (
      !staffId || staffId.dataType !== "uuid" || !staffId.notNull ||
      staffId.defaultExpression !== null || staffId.generated !== "" || staffId.identity !== ""
    ) {
      prereqIssues.push([`column ${table}.staff_id`, "canonical UUID NOT NULL staff_id prerequisite drifted"]);
    }
  }
  const storedValue = column(snapshot, "charges", "stored_value_cents");
  if (
    !storedValue || storedValue.dataType !== "integer" || storedValue.notNull ||
    storedValue.defaultExpression !== null || storedValue.generated !== "" || storedValue.identity !== ""
  ) {
    prereqIssues.push(["column charges.stored_value_cents", "canonical nullable integer prerequisite drifted"]);
  }
  const role = column(snapshot, "staff", "role");
  if (
    !role || role.dataType !== "text" || !role.notNull ||
    normalizedSql(role.defaultExpression ?? "") !== normalizedSql("'provider'::text") ||
    role.generated !== "" || role.identity !== ""
  ) {
    prereqIssues.push(["column staff.role", "canonical provider role prerequisite drifted"]);
  }

  if (artifactObjects.size === 0) {
    if (prereqIssues.length > 0) {
      for (const [object, reason] of prereqIssues) addIssue(objects, reasons, object, reason);
      return bounded("blocked", objects, reasons);
    }
    return { state: "missing", objects: [], reasons: ["0060 artifacts are absent; canonical prerequisites are valid"] };
  }

  for (const [object, reason] of prereqIssues) addIssue(objects, reasons, object, reason);

  for (const spec of VIEW_SPECS) {
    const object = relation(snapshot, spec.name);
    const expectedColumns = spec.columns.map(([, exposed]) => exposed);
    const actualColumns = snapshot.columns
      .filter((candidate) => candidate.table === spec.name)
      .sort((a, b) => a.position - b.position)
      .map((candidate) => candidate.name);
    const metadata = snapshot.viewMetadata.find((candidate) => candidate.name === spec.name);
    if (!object || object.kind !== "v") {
      addIssue(objects, reasons, `view ${spec.name}`, "legacy relation is missing or is not an ordinary view");
      continue;
    }
    if (normalizedSql(object.definition ?? "", schema) !== normalizedSql(viewDefinition(spec), schema)) {
      addIssue(objects, reasons, `view ${spec.name}`, "view projection or base relation differs from migration 0060");
    }
    if (object.options.length !== 1 || object.options[0] !== "security_invoker=true") {
      addIssue(objects, reasons, `view ${spec.name}`, "view security_invoker option differs from migration 0060");
    }
    if (!metadata?.updatable || !metadata.insertable) {
      addIssue(objects, reasons, `view ${spec.name}`, "view is not updatable and insertable");
    }
    if (actualColumns.length !== expectedColumns.length || actualColumns.some((name, index) => name !== expectedColumns[index])) {
      addIssue(objects, reasons, `view ${spec.name}`, "view columns or column order differ from migration 0060");
    }
  }

  for (const alias of ALIAS_COLUMNS) {
    const found = column(snapshot, alias.table, alias.name);
    const expectedDefault = alias.table === "staff" ? "'stylist'::text" : "";
    if (
      !found || found.dataType !== alias.type || found.notNull !== alias.notNull ||
      normalizedSql(found.defaultExpression ?? "") !== normalizedSql(expectedDefault) ||
      found.generated !== "" || found.identity !== ""
    ) {
      addIssue(objects, reasons, `column ${alias.table}.${alias.name}`, "alias column definition differs from migration 0060");
    }
  }

  const expectedFunctionHashes = new Map([
    [ROLE_FUNCTION, ROLE_SOURCE_SHA256],
    [STAFF_ID_FUNCTION, STAFF_ID_SOURCE_SHA256],
    [STORED_VALUE_FUNCTION, STORED_VALUE_SOURCE_SHA256],
  ]);
  for (const [name, expectedHash] of expectedFunctionHashes) {
    const found = snapshot.functions.filter((fn) => fn.name === name);
    const fn = found[0];
    if (
      found.length !== 1 || !fn || fn.kind !== "f" || fn.identityArguments !== "" ||
      fn.returnType !== "trigger" || fn.language !== "plpgsql" || fn.securityDefiner ||
      fn.isStrict || fn.volatility !== "v" || fn.parallel !== "u" || fn.leakproof ||
      fn.config.length !== 1 || fn.config[0] !== "search_path=pg_catalog" || fn.returnsSet ||
      sourceHash(fn.source) !== expectedHash
    ) {
      addIssue(objects, reasons, `function ${name}`, "function signature, body, security, or configuration differs from migration 0060");
    }
  }

  const expectedTriggerCount = TRIGGER_TARGETS.length;
  if (snapshot.triggers.length !== expectedTriggerCount) {
    addIssue(objects, reasons, `trigger ${TRIGGER_NAME}`, "trigger set is incomplete or contains extra same-named triggers");
  }
  for (const target of TRIGGER_TARGETS) {
    const found = snapshot.triggers.filter((trigger) => trigger.name === TRIGGER_NAME && trigger.table === target.table);
    const trigger = found[0];
    const expectedDefinition = `CREATE TRIGGER ${quoteIdentifier(TRIGGER_NAME)} BEFORE INSERT OR UPDATE ON ${quoteIdentifier(schema)}.${quoteIdentifier(target.table)} FOR EACH ROW EXECUTE FUNCTION ${quoteIdentifier(schema)}.${quoteIdentifier(target.functionName)}()`;
    if (
      found.length !== 1 || !trigger || trigger.functionName !== target.functionName ||
      trigger.functionSchema !== schema || trigger.enabled !== "O" || trigger.type !== 23 ||
      trigger.argumentCount !== 0 || trigger.condition !== null ||
      normalizedSql(trigger.definition, schema) !== normalizedSql(expectedDefinition, schema)
    ) {
      addIssue(objects, reasons, `trigger ${target.table}.${TRIGGER_NAME}`, "trigger binding, mode, condition, or definition differs from migration 0060");
    }
  }

  for (const target of TRIGGER_TARGETS) {
    const key = `${target.table}.${target.table === "staff" ? "legacy_stylist_role" : target.table === "charges" ? "beauty_bank_cents" : "stylist_id"}`;
    const mismatch = snapshot.dataMismatches[key];
    if (mismatch !== 0) {
      addIssue(objects, reasons, `data ${key}`, Number.isFinite(mismatch) ? "canonical and alias values are not synchronized" : "synchronization aggregate was unavailable");
    }
  }

  if (objects.length === 0 && expectedArtifactsPresent(snapshot)) {
    return { state: "present", objects: [], reasons: ["0060 footprint and synchronized aliases match migration 0060"] };
  }
  return bounded("partial", objects, reasons);
}

function bounded(
  state: DomainCompatibilityState,
  objects: string[],
  reasons: string[],
): DomainCompatibilityInspection {
  const limit = Math.max(1, MAX_DETAILS);
  return {
    state,
    objects: [...new Set(objects)].slice(0, limit),
    reasons: [...new Set(reasons)].slice(0, limit),
  };
}

/** Reads only catalog definitions and aggregate synchronization counts. */
export async function inspectDomainCompatibilityRepair(
  executor: CatalogExecutor,
  schema: string,
): Promise<DomainCompatibilityInspection> {
  if (!safeSchemaName(schema)) {
    return { state: "blocked", objects: ["schema"], reasons: ["invalid tenant schema name"] };
  }
  try {
    return classifyDomainCompatibilitySnapshot(await collectSnapshot(executor, schema), schema);
  } catch {
    return { state: "blocked", objects: ["catalog"], reasons: ["read-only catalog inspection failed"] };
  }
}
