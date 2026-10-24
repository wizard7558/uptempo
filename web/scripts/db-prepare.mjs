/** Fresh installs use the fixed 0037 checkpoint, then real SQL migrations. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const migrationsFolder = path.join(projectDir, "drizzle");
export const BASELINE_INDEX = 37;
export const LOCK_NAME = "uptempo:public-migrations";
const journalTable = "drizzle.__drizzle_migrations";
class ReconciliationRequiredError extends Error {}
const refuse = (detail) => { throw new ReconciliationRequiredError(`Database reconciliation required: ${detail}`); };
export class MigrationPhaseError extends Error {
  constructor(phase, cause, secondary = []) {
    let trusted=cause;
    while (trusted instanceof MigrationPhaseError) trusted=trusted.cause;
    super(trusted instanceof ReconciliationRequiredError ? trusted.message : "Migration operation failed", { cause });
    this.phase = { ...phase }; this.secondary = secondary;
    this.code = errorCode(cause);
  }
}
export const initialPhase = () => ({ baseline: "not_started", tail: "not_started", catalog: "unverified", cleanup: "pending", clientClose: "pending", outcome: "NOT_COMPLETED" });
export function errorCode(error) {
  const seen = new Set();
  while (error && !seen.has(error)) {
    seen.add(error);
    if (/^[A-Z0-9_]{2,32}$/.test(error.code ?? '')) return error.code;
    error = error.cause;
  }
  return undefined;
}
export const connectionUnknown = (error) => {
  if (error instanceof ReconciliationRequiredError) return false;
  if (error instanceof MigrationPhaseError) return error.phase.outcome === "UNKNOWN";
  const code = errorCode(error);
  return !code || !/^[0-9A-Z]{5}$/.test(code) || /^(08|57P0)/.test(code) || code === '40003';
};
export function directMigrationUrl(value) {
  let url;
  try { url = new URL(value); } catch { refuse("invalid migration connection URL"); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || /[,]/.test(url.hostname)) refuse("migration requires one PostgreSQL endpoint");
  const host = url.hostname.toLowerCase();
  const canonical = /^(ep-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)-pooler\.(c-\d+\.)?([a-z]{2}-[a-z]+-\d+)\.aws\.neon\.tech$/.exec(host);
  if (canonical) { url.hostname = `${canonical[1]}.${canonical[2] ?? ''}${canonical[3]}.aws.neon.tech`; return url.toString(); }
  if (/pooler|pgbouncer/i.test(host)) refuse("unsupported pooled migration endpoint; provide its documented direct endpoint");
  return value;
}
export function assertDedicatedClient(sql) {
  const options = sql?.options;
  if (!options || options.max !== 1 || options.host?.length !== 1 || /pooler|pgbouncer|,/.test(options.host[0].toLowerCase())
    || options.idle_timeout !== 0 || options.max_lifetime !== 0) refuse("migration requires a direct single-host client with max=1 and idle_timeout=max_lifetime=0");
}
export function createMigrationClient(value) {
  return postgres(directMigrationUrl(value), { max: 1, idle_timeout: 0, max_lifetime: 0, onnotice: () => {} });
}
export async function closeMigrationClient(sql, result, primary) {
  try { await sql.end({ timeout: 5 }); if (primary instanceof MigrationPhaseError) primary.phase.clientClose = 'complete'; }
  catch (error) {
    if (primary instanceof MigrationPhaseError) { primary.secondary.push({ stage: 'close', error }); primary.phase.clientClose = 'failed'; }
    else primary = new MigrationPhaseError({ ...(result?.phase ?? initialPhase()), clientClose: 'failed', outcome: 'CLEANUP_FAILED' }, primary ?? error,
      primary ? [{ stage: 'close', error }] : []);
  }
  if (primary) throw primary;
  return { ...result, phase: { ...result.phase, clientClose: 'complete' } };
}

export function migrationPlan() {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
  return readMigrationFiles({ migrationsFolder }).map((migration, i) => ({ ...migration, ...journal.entries[i] }));
}

export async function bootstrapPlan() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta/0037_snapshot.json"), "utf8"));
  return { snapshot, statements: await generateMigration(generateDrizzleJson({}), snapshot),
    migrations: migrationPlan().filter((entry) => entry.idx <= BASELINE_INDEX) };
}

/** Read only: never infer migration history from the presence of tenants. */
export async function databaseState(sql) {
  const [journal] = await sql`SELECT to_regclass(${journalTable}) IS NOT NULL AS present`;
  const rows = journal.present
    ? await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id` : [];
  const [catalog] = await sql`SELECT count(*)::int AS objects FROM (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND NOT (n.nspname = 'drizzle' AND (c.relname = '__drizzle_migrations'
        OR c.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid = to_regclass('drizzle.__drizzle_migrations'))
        OR c.oid = coalesce(pg_get_serial_sequence(to_regclass('drizzle.__drizzle_migrations')::text, 'id')::regclass, 0::oid)))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND (t.typtype IN ('e','d','r','m') OR t.typrelid IN (SELECT oid FROM pg_class WHERE relkind = 'c'))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    UNION ALL
    SELECT n.oid FROM pg_namespace n WHERE n.nspname !~ '^pg_'
      AND n.nspname NOT IN ('information_schema', 'public', 'drizzle')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
    UNION ALL SELECT oid FROM pg_event_trigger
    UNION ALL SELECT oid FROM pg_default_acl
    UNION ALL SELECT oid FROM pg_publication
  ) application_objects`;
  return { rows, fresh: rows.length === 0 && catalog.objects === 0 };
}

export function assertKnownJournal(rows, migrations = migrationPlan()) {
  if (!rows.length) refuse("existing database has no verified migration journal; reconcile manually before migrating");
  if (rows.length > migrations.length || rows.some((row, i) =>
    row.hash !== migrations[i].hash || Number(row.created_at) !== migrations[i].folderMillis)) {
    refuse("migration journal is unknown, incomplete, or differs from the committed SQL");
  }
}

export async function verifySlugIndex(sql) {
  const [index] = await sql`SELECT i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL AND i.indpred IS NULL
      AND a.attnotnull AND a.atttypid = 'text'::regtype AND am.amname = 'btree'
      AND i.indkey[0] = a.attnum AS eligible
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace JOIN pg_am am ON am.oid = c.relam
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'slug' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relname = 'tenants_slug_unique'
      AND tn.nspname = 'public' AND t.relname = 'tenants'`;
  if (!index?.eligible) refuse("public.tenants_slug_unique is not an eligible tenant slug key");
}

// Exact PG17 deparsed forms for the fixed 0037/0038 checks. Preserve literals and Boolean grouping.
const CHECK_EXPRESSIONS = {
  "hosted_text_boundary_kind_check": "(boundary_kind = ANY (ARRAY['trial_end'::text, 'resumed'::text, 'created'::text]))",
  "hosted_text_boundary_pair_check": "((billable_from IS NULL) = (boundary_kind IS NULL))",
  "hosted_text_lifecycle_state_check": "(lifecycle_state = ANY (ARRAY['unresolved'::text, 'free'::text, 'activating'::text, 'ready'::text, 'uncertain'::text, 'stopped'::text]))",
  "hosted_text_ready_check": "((lifecycle_state <> 'ready'::text) OR ((billable_from IS NOT NULL) AND (meter_item_id IS NOT NULL)))",
  "sms_usage_reports_dispatch_facts_check": "((report_status = 'submitted'::text) OR ((customer_id IS NOT NULL) AND (subscription_id IS NOT NULL) AND (meter_event_identifier IS NOT NULL) AND (meter_event_timestamp IS NOT NULL) AND (first_attempt_at IS NOT NULL) AND (quantity >= 0) AND (meter_event_timestamp >= 0)))",
  "sms_usage_reports_meter_timestamp_check": "((meter_event_timestamp IS NULL) OR (meter_event_timestamp >= 0))",
  "sms_usage_reports_reported_at_check": "(((report_status = 'submitted'::text) AND (reported_at IS NOT NULL)) OR ((report_status = ANY (ARRAY['pending'::text, 'uncertain'::text])) AND (reported_at IS NULL)))",
  "sms_usage_reports_status_check": "(report_status = ANY (ARRAY['pending'::text, 'submitted'::text, 'uncertain'::text]))",
  "tenants_processing_rate_bps_range": "((processing_rate_bps IS NULL) OR ((processing_rate_bps >= 0) AND (processing_rate_bps <= 1000)))",
  "tenants_sms_line_status_check": "(sms_line_status = ANY (ARRAY['off'::text, 'shared'::text, 'pending'::text, 'action_needed'::text, 'active'::text]))"
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshotDefault = (column) => {
  if (column.default === undefined) return null;
  const value = String(column.default);
  return column.type === 'text' && /^'(?:[^']|'')*'$/.test(value) ? `${value}::text` : value;
};
async function verifySnapshot(sql, snapshot) {
  const tables = Object.values(snapshot.tables), names = tables.map((table) => table.name);
  const columns = await sql`SELECT t.relname AS table_name, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull, a.attidentity, a.attgenerated, a.attcollation = ty.typcollation AS default_collation,
      pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid
    JOIN pg_type ty ON ty.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND t.relkind='r' AND t.relname=ANY(${names}) AND a.attnum>0 AND NOT a.attisdropped`;
  const indexes = await sql`SELECT i.indexrelid::text AS oid, t.relname AS table_name,c.relname AS name,
      i.indisunique,i.indisvalid,i.indisready,i.indimmediate,i.indnullsnotdistinct,i.indnatts,i.indnkeyatts,
      am.amname,pg_get_expr(i.indexprs,i.indrelid) AS expression,pg_get_expr(i.indpred,i.indrelid) AS predicate,
      ARRAY(SELECT option::int FROM unnest(i.indoption) option) AS options,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE k.ord<=i.indnkeyatts) AS columns,
      (SELECT bool_and(o.opcdefault AND o.opcmethod=c.relam) FROM unnest(i.indclass) k(oid)
        JOIN pg_opclass o ON o.oid=k.oid) AS default_opclasses,
      (SELECT bool_and(i.indcollation[(k.ord-1)::int]=a.attcollation) FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE k.ord<=i.indnkeyatts) AS default_collations
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=c.relam
    WHERE n.nspname='public' AND t.relname=ANY(${names})`;
  const constraints = await sql`SELECT c.conname AS name,c.contype,c.convalidated,c.condeferrable,c.condeferred,
      c.conindid::text AS index_oid,t.relname AS table_name,c.confdeltype,c.confupdtype,c.confmatchtype,
      rn.nspname AS target_schema,rt.relname AS target_table,pg_get_expr(c.conbin,c.conrelid) AS expression,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num) AS columns,
      (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=rt.oid AND a.attnum=k.num) AS target_columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_class rt ON rt.oid=c.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rt.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY(${names})`;
  const eligibleIndex = (index, keys, unique, predicate = null, options = keys.map(() => 0)) => index
    && same(index.columns,keys) && index.indisunique===unique && index.indisvalid && index.indisready && index.indimmediate
    && index.indnatts===keys.length && index.indnkeyatts===keys.length && index.amname==='btree'
    && index.expression===null && index.predicate===predicate && same(index.options,options)
    && !index.indnullsnotdistinct && index.default_opclasses && index.default_collations;
  for (const table of tables) {
    const actual = columns.filter((row) => row.table_name===table.name);
    if (actual.length!==Object.keys(table.columns).length || Object.values(table.columns).some((column) => !actual.some((row) =>
      row.attname===column.name && row.attnotnull===column.notNull && row.type.replace(' without time zone','')===column.type
      && row.default_value===snapshotDefault(column) && row.default_collation && !row.attidentity && !row.attgenerated))) refuse('checkpoint column/type/null/default catalog mismatch');
    const tableConstraints = constraints.filter((row) => row.table_name===table.name);
    const primary = Object.values(table.columns).filter((column) => column.primaryKey).map((column) => column.name);
    const keys = [...Object.values(table.uniqueConstraints).map((key) => ({ ...key, type: 'u' })),
      ...Object.values(table.compositePrimaryKeys).map((key) => ({ ...key, type: 'p' })),
      ...(primary.length ? [{name: `${table.name}_pkey`,columns: primary,type: 'p'}] : [])];
    for (const key of keys) {
      const row = tableConstraints.find((item) => item.name===key.name && item.contype===key.type);
      if (!row?.convalidated || row.condeferrable || row.condeferred || !same(row.columns,key.columns)
        || !eligibleIndex(indexes.find((index) => index.oid===row.index_oid && index.table_name===table.name),key.columns,true)) refuse('checkpoint primary/unique binding catalog mismatch');
    }
    for (const check of Object.values(table.checkConstraints)) {
      const row=tableConstraints.find((item) => item.name===check.name && item.contype==='c');
      if (!row?.convalidated || !CHECK_EXPRESSIONS[check.name] || row.expression!==CHECK_EXPRESSIONS[check.name]) refuse('checkpoint check catalog mismatch');
    }
    for (const fk of Object.values(table.foreignKeys)) {
      const row=tableConstraints.find((item) => item.name===fk.name && item.contype==='f');
      const actions={'no action':'a',restrict:'r',cascade:'c','set null':'n','set default':'d'};
      if (!row?.convalidated || row.condeferrable || row.condeferred || !same(row.columns,fk.columnsFrom)
        || !same(row.target_columns,fk.columnsTo) || row.target_schema!==(fk.schemaTo ?? 'public') || row.target_table!==fk.tableTo
        || row.confdeltype!==actions[fk.onDelete] || row.confupdtype!==actions[fk.onUpdate] || row.confmatchtype!=='s') refuse('checkpoint foreign key catalog mismatch');
    }
    for (const index of Object.values(table.indexes)) {
      const row=indexes.find((item) => item.table_name===table.name && item.name===index.name);
      const predicate=index.where ? (index.name==='tenants_stripe_subscription_unique' ? '(stripe_subscription_id IS NOT NULL)' : undefined) : null;
      if (index.columns.some((key) => key.isExpression) || index.method!=='btree' || predicate===undefined
        || !eligibleIndex(row,index.columns.map((key) => key.expression),index.isUnique,predicate,
          index.columns.map((key) => (key.asc?0:1)+(key.nulls==='first'?2:0)))) refuse('checkpoint declared index catalog mismatch');
    }
  }
}

/** Validate the exact retained 0038 keys/defaults and SQL-owned objects. */
export async function verifyHostedTextMigration(sql) {
  await verifySlugIndex(sql);
  const snapshot=JSON.parse(fs.readFileSync(path.join(migrationsFolder,'meta/0038_snapshot.json'),'utf8'));
  try { await verifySnapshot(sql, { tables: Object.fromEntries(Object.entries(snapshot.tables)
    .filter(([key]) => ['public.hosted_text_billing_state','public.sms_usage_reports'].includes(key))) }); }
  catch (error) { if (error instanceof ReconciliationRequiredError) refuse('0038 key/column/default/constraint catalog mismatch'); throw error; }
  const source = fs.readFileSync(path.join(migrationsFolder, '0038_hosted_text_billing_lifecycle.sql'), 'utf8');
  const body = source.split('$facts$')[1].trim();
  const [fn] = await sql`SELECT p.oid::int, p.prosecdef, p.proconfig, p.prosrc, p.prorettype = 'trigger'::regtype AS returns_trigger,
      l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname = 'hosted_text_preserve_report_facts' AND p.pronargs = 0`;
  if (!fn || fn.prosecdef || JSON.stringify(fn.proconfig) !== JSON.stringify(['search_path=pg_catalog'])
    || fn.prosrc.trim() !== body || !fn.returns_trigger || fn.lanname !== 'plpgsql') refuse("0038 immutability function catalog mismatch");
  const [trigger] = await sql`SELECT tgfoid::int, tgtype, tgenabled, tgnargs, tgqual, tgattr::text AS columns
    FROM pg_trigger WHERE tgrelid = 'public.sms_usage_reports'::regclass
      AND tgname = 'hosted_text_preserve_report_facts' AND NOT tgisinternal`;
  if (!trigger || trigger.tgfoid !== fn.oid || trigger.tgtype !== 19 || trigger.tgenabled !== 'O'
    || trigger.tgnargs !== 0 || trigger.tgqual !== null || trigger.columns !== '') refuse("0038 immutability trigger catalog mismatch");
}

export async function verifyPublicSearchPath(sql) {
  const [scope]=await sql`SELECT current_schema()='public' AS public_schema,
    (current_schemas(true))[1:2]=ARRAY['pg_catalog','public']::name[] AS public_path`;
  if (!scope.public_schema || !scope.public_path) refuse('public migration search_path is unavailable');
}

export async function prepareDatabase(sql) {
  assertDedicatedClient(sql);
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SET LOCAL search_path = public`;
    await verifyPublicSearchPath(tx);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
    const state = await databaseState(tx);
    if (state.rows.length) {
      const tail = migrationPlan().find((entry) => entry.idx === 38);
      const stamped=state.rows.some((row) => row.hash===tail.hash || Number(row.created_at)===tail.when);
      if (stamped) await verifyHostedTextMigration(tx);
      return { status: "existing", baseline: false, phase: { ...initialPhase(), baseline: "existing", catalog: stamped ? "verified" : "unverified" } };
    }
    if (!state.fresh) refuse("application objects exist without a verified journal; reconcile manually");
    const plan = await bootstrapPlan();
    await tx`CREATE EXTENSION IF NOT EXISTS btree_gist`;
    for (const statement of plan.statements) await tx.unsafe(statement);
    await verifySnapshot(tx, plan.snapshot);
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations
      (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    for (const entry of plan.migrations) {
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${entry.hash}, ${entry.folderMillis})`;
    }
    return { status: "baseline-only; run migrate:platform for subsequent SQL", baseline: true, phase: { ...initialPhase(), baseline: "committed", catalog: "verified" } };
  }).then((result) => ({ ...result,phase:{ ...result.phase,cleanup:'complete' } })).catch(async (error) => {
    const unknown=connectionUnknown(error), phase={ ...initialPhase(), baseline: unknown ? 'unknown' : 'not_committed', outcome: unknown ? 'UNKNOWN' : 'NOT_COMMITTED' };
    const secondary=[];
    if (unknown) { try { await sql.end({ timeout: 0 }); } catch (close) { secondary.push({stage:'fatal-close',error:close}); } }
    throw new MigrationPhaseError(phase,error,secondary);
  });
}

/** Messages never include native errors, SQL, connection URLs, or credentials. */
export function safeFailure(error) {
  const code=errorCode(error), suffix=code ? ` (${code})` : '';
  const phase=error instanceof MigrationPhaseError ? ` outcome=${error.phase.outcome}; baseline=${error.phase.baseline}; tail=${error.phase.tail}; catalog=${error.phase.catalog}; cleanup=${error.phase.cleanup}; close=${error.phase.clientClose}.` : '';
  let trusted=error;
  while (trusted instanceof MigrationPhaseError) trusted=trusted.cause;
  const detail=trusted instanceof ReconciliationRequiredError ? ` ${trusted.message}` : '';
  const secondary=error instanceof MigrationPhaseError && error.secondary.length ? ` Secondary cleanup failures: ${error.secondary.map((item) => item.stage).join(', ')}.` : '';
  return `Database preparation/migration failed${suffix}.${detail}${phase}${secondary} No completion claimed; inspect the journal and reconcile before retrying.`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  const sql = createMigrationClient(process.env.DATABASE_URL);
  let result, primary;
  try { result = await prepareDatabase(sql); } catch (error) { primary = error; }
  result = await closeMigrationClient(sql,result,primary);
  console.log(`[db-prepare] ${JSON.stringify(result)}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`[db-prepare] ${safeFailure(error)}`); process.exitCode = 1; });
}
