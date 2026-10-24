import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { prepareDatabase, bootstrapPlan, migrationPlan, databaseState, verifyHostedTextMigration, LOCK_NAME } from "./db-prepare.mjs";
import { migratePlatform } from "./migrate-platform.mjs";


const enabled = process.env.BOOTSTRAP_DB_TEST === "1";
describe.skipIf(!enabled)("fresh public database bootstrap (owned PostgreSQL 17)", () => {
  let client: postgres.Sql;
  let owned = false;
  beforeAll(async () => {
    const runId = process.env.BOOTSTRAP_DB_RUN_ID;
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!runId || !/^[a-z0-9_]+$/.test(runId) || url.hostname !== "127.0.0.1"
      || Number(url.port) <= 1024 || url.port === "5432" || url.pathname !== `/bootstrap_test_${runId}`
      || url.search || url.hash) throw new Error("Requires an owned loopback bootstrap test database");
    client = postgres(url.toString(), { max: 1, idle_timeout: 0, max_lifetime: 0, onnotice: () => {} });
    const [db] = await client`SELECT shobj_description(oid, 'pg_database') AS marker
      FROM pg_database WHERE datname = current_database()`;
    if (db.marker !== `uptempo bootstrap disposable ${runId}`) throw new Error("Owned database marker missing");
    owned = true;
  });
  const clear = async () => {
    if (!owned) throw new Error("Refusing cleanup without database ownership");
    await client.unsafe("DROP PUBLICATION IF EXISTS bootstrap_publication");
    await client.unsafe("DROP EVENT TRIGGER IF EXISTS bootstrap_tail_failure");
    await client.unsafe("DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public");
    await client.unsafe("DROP SCHEMA IF EXISTS bootstrap_unexpected CASCADE");
  };
  beforeEach(clear);
  afterAll(async () => { if (client) { try { if (owned) await clear(); } finally { await client.end(); } } });
  const journal = () => client.unsafe("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
  const complete = async () => { await prepareDatabase(client); await migratePlatform(client); };
  const catalog = () => client.unsafe(`SELECT c.oid, n.nspname, c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','drizzle') ORDER BY c.oid`);
  const dedicated = () => postgres(process.env.DATABASE_URL!, {max:1,idle_timeout:0,max_lifetime:0,onnotice:()=>{}});
  const intercept = (target: postgres.Sql, hook: (query: string, execute: () => Promise<unknown>) => Promise<unknown>): postgres.Sql =>
    new Proxy(target, {
      apply(fn, receiver, args) { return hook(args[0].join('?'), () => Reflect.apply(fn, receiver, args)); },
      get(fn, key) {
        if (key === 'unsafe') return (...args: unknown[]) => hook(String(args[0]), () => Reflect.apply(fn.unsafe, fn, args));
        if (key === 'begin') return (callback: (tx: postgres.Sql) => Promise<unknown>) => fn.begin((tx) => callback(intercept(tx as unknown as postgres.Sql, hook)));
        return Reflect.get(fn,key);
      },
    });
  const cli = (file: string) => spawnSync(process.execPath, [`scripts/${file}.mjs`], { env: process.env, encoding: "utf8" });
  it("creates a complete schema with the actual SQL-owned 0038 trigger", async () => {
    const child = spawnSync(process.execPath, ["scripts/db-prepare.mjs"], { env: process.env, encoding: "utf8" });
    console.log("db-prepare exit:", child.status, (child.stdout + child.stderr).slice(-4500));
    expect(child.status).toBe(0);
    const migration = spawnSync(process.execPath, ["scripts/migrate-platform.mjs"], { env: process.env, encoding: "utf8" });
    console.log("migrate-platform exit:", migration.status, (migration.stdout + migration.stderr).slice(-4500));
    expect(migration.status).toBe(0);
    const [catalog] = await client`SELECT to_regprocedure('public.hosted_text_preserve_report_facts()') IS NOT NULL AS immutable`;
    expect(catalog.immutable).toBe(true);
    await client`INSERT INTO public.tenants (name, slug) VALUES ('Test', 'test')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`;
  }, 60_000);
  it("supports the canonical direct migrate-platform CLI on an empty database", async () => {
    const result = cli('migrate-platform');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('complete');
    expect(await journal()).toHaveLength(39);
    await verifyHostedTextMigration(client);
  });

  it("baselines exactly 0000–0037, then runs the complete tail and preserves rows, index OID, and journal on repeat", async () => {
    const plan = await bootstrapPlan();
    expect(await prepareDatabase(client)).toMatchObject({ baseline: true });
    expect(await journal()).toEqual(plan.migrations.map((entry: { hash: string; folderMillis: number }) =>
      ({ hash: entry.hash, created_at: String(entry.folderMillis) })));
    expect((await client`SELECT to_regprocedure('public.hosted_text_preserve_report_facts()') AS fn`)[0].fn).toBeNull();
    await client`INSERT INTO public.tenants (name, slug) VALUES ('Owned','owned')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`;
    await expect(client`INSERT INTO public.tenants (name, slug) VALUES ('Duplicate','owned')`).rejects.toMatchObject({ code: '23505' });
    const beforeIndex = await client`SELECT oid, pg_get_indexdef(oid) AS definition FROM pg_class WHERE oid='public.tenants_slug_unique'::regclass`;
    await migratePlatform(client);
    await verifyHostedTextMigration(client);
    await expect(client`INSERT INTO public.hosted_text_billing_state (tenant_slug,customer_id,subscription_id)
      VALUES ('absent','cus_absent','sub_absent')`).rejects.toMatchObject({ code: '23503' });
    await client`INSERT INTO public.hosted_text_billing_state (tenant_slug,customer_id,subscription_id)
      VALUES ('owned','cus_owned','sub_owned')`;
    await expect(client`UPDATE public.hosted_text_billing_state SET lifecycle_state='invalid'`).rejects.toMatchObject({ code: '23514' });
    await client`INSERT INTO public.sms_usage_reports (tenant_slug,usage_date,quantity) VALUES ('owned','2026-10-23',1)`;
    await expect(client`UPDATE public.sms_usage_reports SET quantity=2`).rejects.toMatchObject({ code: '23514' });
    const rows = await client`SELECT * FROM public.tenants`;
    const reports = await client`SELECT * FROM public.sms_usage_reports`;
    const ledger = await journal();
    const objects = await catalog();
    expect(ledger).toHaveLength(39);
    expect(await prepareDatabase(client)).toMatchObject({ baseline: false });
    await migratePlatform(client);
    expect(await journal()).toEqual(ledger);
    expect(await catalog()).toEqual(objects);
    expect(await client`SELECT * FROM public.tenants`).toEqual(rows);
    expect(await client`SELECT * FROM public.sms_usage_reports`).toEqual(reports);
    expect(await client`SELECT oid, pg_get_indexdef(oid) AS definition FROM pg_class WHERE oid='public.tenants_slug_unique'::regclass`).toEqual(beforeIndex);
  });

  it("allows extension-owned objects and an empty precreated journal", async () => {
    await client`CREATE EXTENSION btree_gist`;
    await client.unsafe(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations
      (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    expect((await databaseState(client)).fresh).toBe(true);
    await complete();
    expect(await journal()).toHaveLength(39);
  });

  it.each([
    'CREATE TABLE public.tenants (id uuid PRIMARY KEY, slug text)',
    "CREATE TABLE public.partial (value text); INSERT INTO public.partial VALUES ('keep')",
    'CREATE VIEW public.partial AS SELECT 1 AS value',
    'CREATE SEQUENCE public.partial',
    'CREATE FUNCTION public.partial() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
    "CREATE TYPE public.partial AS ENUM ('keep')",
    'CREATE DOMAIN public.partial AS text',
    'CREATE SCHEMA bootstrap_unexpected',
  ])("rejects a nonempty application catalog before any writes: %s", async (ddl) => {
    await client.unsafe(ddl);
    const before = await catalog();
    await expect(prepareDatabase(client)).rejects.toThrow('reconciliation required');
    const result = cli('migrate-platform');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('reconciliation required');
    expect(await catalog()).toEqual(before);
    expect((await client`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)[0].ledger).toBeNull();
  });

  it("refuses an unjournaled populated legacy database before archiving or clearing rows", async () => {
    await client.unsafe(`CREATE TABLE public.tenants (id uuid PRIMARY KEY, slug text);
      CREATE TABLE public.salons (id integer, name text); INSERT INTO public.salons VALUES (1,'Preserve')`);
    const rows = await client`SELECT * FROM public.salons`;
    const objects = await catalog();
    await expect(migratePlatform(client)).rejects.toThrow('reconciliation required');
    expect(await client`SELECT * FROM public.salons`).toEqual(rows);
    expect(await catalog()).toEqual(objects);
    expect((await client`SELECT to_regclass('public.archive_legacy_salons') AS archive`)[0].archive).toBeNull();
  });

  it("leaves unknown journal rows and data unchanged in prepare and rejects them before migration", async () => {
    await client.unsafe(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations
      (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('unknown-preserve',9999999999999);
      CREATE TABLE public.keep (value text); INSERT INTO public.keep VALUES ('keep')`);
    const ledger = await journal();
    const objects = await catalog();
    expect(await prepareDatabase(client)).toMatchObject({ baseline: false });
    await expect(migratePlatform(client)).rejects.toThrow('reconciliation required');
    expect(await journal()).toEqual(ledger);
    expect(await catalog()).toEqual(objects);
    expect(await client`SELECT * FROM public.keep`).toEqual([{ value: 'keep' }]);
  });

  it("rolls back every baseline table and journal row on an injected DDL failure", async () => {
    let executed = 0;
    const interrupted = new Proxy(client, { get(target, property) {
      if (property !== 'begin') return Reflect.get(target, property);
      return (callback: (tx: postgres.TransactionSql) => Promise<unknown>) => target.begin((tx) => callback(
        new Proxy(tx, { get(inner, key) {
          if (key !== 'unsafe') return Reflect.get(inner, key);
          return async (statement: string) => {
            if (statement.startsWith('CREATE TABLE')) executed++;
            if (executed === 5) return inner.unsafe('SELECT 1/0');
            return inner.unsafe(statement);
          };
        } }),
      ));
    } });
    await expect(prepareDatabase(interrupted)).rejects.toMatchObject({ code: '22012' });
    expect(executed).toBe(5);
    expect((await databaseState(client)).fresh).toBe(true);
    expect(await catalog()).toEqual([]);
    expect((await client`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)[0].ledger).toBeNull();
  });

  it("rolls back a failed checkpoint catalog verification instead of stamping history", async () => {
    const interrupted = new Proxy(client, { get(target, property) {
      if (property !== 'begin') return Reflect.get(target, property);
      return (callback: (tx: postgres.TransactionSql) => Promise<unknown>) => target.begin((tx) => callback(
        new Proxy(tx, { get(inner, key) {
          if (key !== 'unsafe') return Reflect.get(inner, key);
          return (statement: string) => inner.unsafe(statement.replace('CREATE UNIQUE INDEX "tenants_slug_unique"', 'CREATE INDEX "tenants_slug_unique"'));
        } }),
      ));
    } });
    await expect(prepareDatabase(interrupted)).rejects.toThrow('declared index catalog mismatch');
    expect((await databaseState(client)).fresh).toBe(true);
    expect(await catalog()).toEqual([]);
  });

  it("propagates a tail failure with no 0038 marker, table, or immutability function", async () => {
    await prepareDatabase(client);
    const baseline = await journal();
    await client.unsafe(`CREATE FUNCTION public.bootstrap_tail_failure() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF tg_tag = 'CREATE TRIGGER' THEN RAISE EXCEPTION 'synthetic-private-diagnostic'; END IF; END $$;
      CREATE EVENT TRIGGER bootstrap_tail_failure ON ddl_command_start EXECUTE FUNCTION public.bootstrap_tail_failure()`);
    const result = cli('migrate-platform');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No completion claimed');
    expect(result.stdout + result.stderr).not.toContain('synthetic-private-diagnostic');
    expect(await journal()).toEqual(baseline);
    expect((await client`SELECT to_regclass('public.hosted_text_billing_state') AS state,
      to_regprocedure('public.hosted_text_preserve_report_facts()') AS fn`)[0]).toEqual({ state: null, fn: null });
    await client.unsafe('DROP EVENT TRIGGER bootstrap_tail_failure; DROP FUNCTION public.bootstrap_tail_failure()');
    await migratePlatform(client);
    expect(await journal()).toHaveLength(39);
  });

  it("refuses a fake 0038 journal stamp over the baseline without repairing or restamping", async () => {
    await prepareDatabase(client);
    const tail = migrationPlan().at(-1)!;
    await client`INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES (${tail.hash},${tail.folderMillis})`;
    const ledger = await journal();
    const objects = await catalog();
    await expect(prepareDatabase(client)).rejects.toThrow('0038');
    await expect(migratePlatform(client)).rejects.toThrow('0038');
    expect(await journal()).toEqual(ledger);
    expect(await catalog()).toEqual(objects);
  });

  it.each([
    'ALTER TABLE public.sms_usage_reports DROP CONSTRAINT sms_usage_reports_pkey',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_customer_id_unique; ALTER TABLE public.hosted_text_billing_state ADD CONSTRAINT hosted_text_billing_state_customer_id_unique UNIQUE (subscription_id)',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_customer_id_unique; ALTER TABLE public.hosted_text_billing_state ADD CONSTRAINT hosted_text_billing_state_customer_id_unique UNIQUE (customer_id) DEFERRABLE',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_customer_id_unique; CREATE UNIQUE INDEX hosted_text_billing_state_customer_id_unique ON public.hosted_text_billing_state(customer_id) WHERE customer_id IS NOT NULL',
    'ALTER TABLE public.sms_usage_reports DROP CONSTRAINT sms_usage_reports_tenant_date_unique; ALTER TABLE public.sms_usage_reports ADD CONSTRAINT sms_usage_reports_tenant_date_unique UNIQUE (usage_date,tenant_slug)',
    "ALTER TABLE public.sms_usage_reports ALTER COLUMN report_status SET DEFAULT 'Submitted'",
    "ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_ready_check; ALTER TABLE public.hosted_text_billing_state ADD CONSTRAINT hosted_text_ready_check CHECK ((lifecycle_state <> 'ready' OR billable_from IS NOT NULL) AND meter_item_id IS NOT NULL)",
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_pkey',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_customer_id_unique',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_subscription_id_unique',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_boundary_event_id_unique',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_meter_item_id_unique',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_meter_operation_id_unique',
    'ALTER TABLE public.sms_usage_reports DROP CONSTRAINT sms_usage_reports_tenant_date_unique',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_tenant_slug_tenants_slug_fk',
    'DROP TRIGGER hosted_text_preserve_report_facts ON public.sms_usage_reports',
    'ALTER TABLE public.sms_usage_reports DROP COLUMN first_attempt_at',
    'ALTER FUNCTION public.hosted_text_preserve_report_facts() SECURITY DEFINER',
    'ALTER FUNCTION public.hosted_text_preserve_report_facts() SET search_path = public',
    'CREATE OR REPLACE FUNCTION public.hosted_text_preserve_report_facts() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RETURN NEW; END $$',
    'ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_ready_check; ALTER TABLE public.hosted_text_billing_state ADD CONSTRAINT hosted_text_ready_check CHECK (true)',
  ])("refuses a stamped but incomplete or altered 0038 catalog without changes: %s", async (ddl) => {
    await complete();
    await client.unsafe(ddl);
    const ledger = await journal();
    const objects = await catalog();
    const results = ['db-prepare', 'migrate-platform'].map(cli);
    expect(results.map((result) => result.status)).toEqual([1, 1]);
    for (const result of results) expect(result.stderr).toContain('0038');
    expect(await journal()).toEqual(ledger);
    expect(await catalog()).toEqual(objects);
  });

  it("serializes concurrent bootstrap/migration runners and rechecks freshness after the lock", async () => {
    const second = postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 0, max_lifetime: 0, onnotice: () => {} });
    try {
      const prepared = await Promise.all([prepareDatabase(client), prepareDatabase(second)]);
      expect(prepared.filter((result) => result.baseline)).toHaveLength(1);
      expect(await journal()).toHaveLength(38);
      await Promise.all([migratePlatform(client), migratePlatform(second)]);
      expect(await journal()).toHaveLength(39);
      const [lock] = await client`SELECT pg_try_advisory_lock(hashtext(${LOCK_NAME})) AS acquired`;
      expect(lock.acquired).toBe(true);
      await client`SELECT pg_advisory_unlock(hashtext(${LOCK_NAME}))`;
    } finally { await second.end(); }
  });

  it.each([
    ['default', 'CREATE TABLE "tenants"', (sql: string) => sql.replace("DEFAULT 'off'", "DEFAULT 'Off'")],
    ['primary key', 'CREATE TABLE "platform_clients"', (sql: string) => sql.replace('PRIMARY KEY','UNIQUE')],
    ['composite primary key', 'CREATE TABLE "job_runs"', (sql: string) => sql.replace(/,\n\s*CONSTRAINT "job_runs_job_id_scheduled_for_pk" PRIMARY KEY\("job_id","scheduled_for"\)/,'')],
    ['FK action', 'ADD CONSTRAINT "account_user_id_user_id_fk"', (sql: string) => sql.replace('ON DELETE cascade','ON DELETE restrict')],
    ['FK target', 'ADD CONSTRAINT "account_user_id_user_id_fk"', (sql: string) => sql.replace('"public"."user"','"public"."verification"')],
    ['Boolean grouping', 'CREATE TABLE "tenants"', (sql: string) => sql.replace('CHECK ("tenants"."processing_rate_bps" IS NULL OR ("tenants"."processing_rate_bps" >= 0 AND "tenants"."processing_rate_bps" <= 1000))','CHECK (("tenants"."processing_rate_bps" IS NULL OR "tenants"."processing_rate_bps" >= 0) AND "tenants"."processing_rate_bps" <= 1000)')],
    ['check literal', 'CREATE TABLE "tenants"', (sql: string) => sql.replace("'active')", "'ACTIVE')")],
    ['index key', 'CREATE UNIQUE INDEX "tenants_slug_unique"', (sql: string) => sql.replace('("slug")','("name")')],
    ['index predicate', 'CREATE UNIQUE INDEX "tenants_slug_unique"', (sql: string) => sql.replace(';', " WHERE slug <> 'excluded';")],
    ['index order', 'CREATE UNIQUE INDEX "webhook_lookup_type_external_id_idx"', (sql: string) => sql.replace('"lookup_type","external_id"','"external_id","lookup_type"')],
    ['index opclass', 'CREATE UNIQUE INDEX "tenants_slug_unique"', (sql: string) => sql.replace('"slug")','"slug" text_pattern_ops)')],
    ['index collation', 'CREATE UNIQUE INDEX "tenants_slug_unique"', (sql: string) => sql.replace('"slug")','"slug" COLLATE "C")')],
  ])("rolls back a checkpoint with an injected wrong %s", async (_name, match, mutate) => {
    let changed=false;
    // Mutate only the native transaction's DDL; never a configured/provider connection.
    const boundary=new Proxy(client,{get(target,key){
      if(key!=='begin')return Reflect.get(target,key);
      return (callback:(tx:postgres.TransactionSql)=>Promise<unknown>)=>target.begin((tx)=>callback(new Proxy(tx,{get(inner,key){
        if(key!=='unsafe')return Reflect.get(inner,key);
        return (query:string)=>{if(query.includes(match as string)){const edited=(mutate as (s:string)=>string)(query);expect(edited).not.toBe(query);changed=true;return inner.unsafe(edited);}return inner.unsafe(query);};
      }})));
    }});
    await expect(prepareDatabase(boundary)).rejects.toThrow('catalog mismatch');
    expect(changed).toBe(true);
    expect(await catalog()).toEqual([]);
    expect((await client`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)[0].ledger).toBeNull();
    expect((await databaseState(client)).fresh).toBe(true);
  });

  it.each(['default privileges','publication'])("refuses preexisting %s without altering it", async (kind) => {
    if(kind==='publication')await client.unsafe('CREATE PUBLICATION bootstrap_publication FOR ALL TABLES');
    else await client.unsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC');
    const before=await client`SELECT oid FROM pg_default_acl UNION ALL SELECT oid FROM pg_publication`;
    await expect(migratePlatform(client)).rejects.toThrow('reconciliation required');
    expect(await client`SELECT oid FROM pg_default_acl UNION ALL SELECT oid FROM pg_publication`).toEqual(before);
    expect((await client`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger`)[0].ledger).toBeNull();
  });

  it("bounds lock contention before bootstrap writes", async () => {
    const holder=dedicated();
    try {
      await holder`SELECT pg_advisory_lock(hashtext(${LOCK_NAME}))`;
      const start=Date.now();
      await expect(prepareDatabase(client)).rejects.toMatchObject({code:'55P03'});
      expect(Date.now()-start).toBeLessThan(15_000);
      expect(await catalog()).toEqual([]);
    } finally {await holder`SELECT pg_advisory_unlock(hashtext(${LOCK_NAME}))`;await holder.end();}
  },20_000);

  it("ends a lost native connection between stages without replacement-transport cleanup", async () => {
    await prepareDatabase(client);
    const migrationClient=dedicated(); let identities=0, afterLoss=0, killed=false;
    const wrapped=intercept(migrationClient,async(query,execute)=>{
      if(killed)afterLoss++;
      const result=await execute();
      if(query.includes('pg_backend_pid') && ++identities===2){
        const pid=(result as Array<{pid:number}>)[0].pid;
        await client`SELECT pg_terminate_backend(${pid})`;killed=true;
        await new Promise((resolve)=>setTimeout(resolve,25));
      }
      return result;
    });
    let failure;
    try {await migratePlatform(wrapped);}catch(error){failure=error;}
    expect(failure).toMatchObject({phase:{baseline:'existing',tail:'not_started',outcome:'UNKNOWN'}});
    expect(afterLoss).toBeLessThanOrEqual(1);
    expect(await journal()).toHaveLength(38);
    await migrationClient.end();
  });

  it.each(['verification','unlock false','unlock error','reset error','verification and cleanup'])(
    "reports truthful committed state and retains the primary failure after %s", async (fault) => {
      await prepareDatabase(client);
      const migrationClient=dedicated(); let identities=0;
      const native=Object.assign(new Error('synthetic-private-diagnostic'),{code:'P0001'});
      const wrapped=intercept(migrationClient,async(query,execute)=>{
        if(query.includes('pg_advisory_unlock')){
          if(fault==='unlock false'){await execute();return [{released:false}];}
          if(fault==='unlock error'||fault==='verification and cleanup')throw native;
        }
        if(query.includes("set_config('lock_timeout'")&&fault==='reset error')throw native;
        const result=await execute();
        if(query.includes('pg_backend_pid')&&++identities===6&&(fault==='verification'||fault==='verification and cleanup')){
          await client.unsafe('ALTER TABLE public.hosted_text_billing_state DROP CONSTRAINT hosted_text_billing_state_customer_id_unique');
        }
        return result;
      });
      let failure;
      try {await migratePlatform(wrapped);}catch(error){failure=error;}
      expect(failure.phase.tail).toBe('committed');
      expect(failure.phase.clientClose).toBe('pending');
      expect(failure.phase.outcome).toBe(fault.startsWith('verification')?'COMMITTED_UNVERIFIED':'COMMITTED_CLEANUP_FAILED');
      expect(await journal()).toHaveLength(39);
      if(fault==='verification and cleanup')expect(failure.secondary[0]).toEqual({stage:'unlock',error:native});
      if(!fault.startsWith('verification')&&fault!=='unlock false')expect(failure.cause).toBe(native);
      await migrationClient.end();
    },
  );

  it("pins public DDL under a nonstandard incoming search path and restores caller session settings", async () => {
    await client`SET search_path=pg_catalog`;
    await client`SET lock_timeout='2s'`;
    try {
      await prepareDatabase(client);
      const result=await migratePlatform(client);
      expect(result).toMatchObject({status:'catalog-verified',phase:{catalog:'verified',cleanup:'complete',clientClose:'pending'}});
      const [settings]=await client`SELECT current_setting('search_path') AS path,current_setting('lock_timeout') AS timeout`;
      expect(settings).toEqual({path:'pg_catalog',timeout:'2s'});
      expect(await client`SELECT tablename FROM pg_tables WHERE schemaname='public'`).toHaveLength(17);
      expect(await journal()).toHaveLength(39);
    } finally {await client`SET search_path=public`;await client`RESET lock_timeout`;}
  });

  it("reports UNKNOWN after a simulated lost commit acknowledgement without retry or cleanup SQL", async () => {
    const migrationClient=dedicated(); let transactions=0, acknowledgementLost=false, continued=0;
    const native=Object.assign(new Error('synthetic-private-commit-loss'),{code:'CONNECTION_CLOSED'});
    const observed=intercept(migrationClient,async(_query,execute)=>{if(acknowledgementLost)continued++;return execute();});
    const wrapped=new Proxy(observed,{get(target,key){
      if(key!=='begin')return Reflect.get(target,key);
      return async (callback:(tx:postgres.TransactionSql)=>Promise<unknown>)=>{
        const result=await migrationClient.begin(callback);
        if(++transactions===3){acknowledgementLost=true;throw native;}
        return result;
      };
    }});
    let failure;
    try{await migratePlatform(wrapped);}catch(error){failure=error;}
    expect(failure).toMatchObject({phase:{baseline:'committed',tail:'commit_unresolved',outcome:'UNKNOWN'}});
    expect(failure.cause).toBe(native);
    expect(continued).toBe(0);
    expect(transactions).toBe(3);
    expect(await journal()).toHaveLength(39);
    await migrationClient.end();
  });

});
