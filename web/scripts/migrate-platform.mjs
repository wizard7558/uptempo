/** Real SQL migrator on one dedicated direct PostgreSQL session. */
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { archiveLegacyPublicTables } from "./archive-legacy-public.mjs";
import { projectDir, migrationsFolder, migrationPlan, databaseState, assertKnownJournal, assertDedicatedClient,
  prepareDatabase, verifySlugIndex, verifyHostedTextMigration, LOCK_NAME, safeFailure, MigrationPhaseError,
  initialPhase, connectionUnknown, createMigrationClient, closeMigrationClient, verifyPublicSearchPath } from "./db-prepare.mjs";

export async function migratePlatform(sql) {
  assertDedicatedClient(sql); // No SQL, URL rewriting, or caller configuration changes before this guard.
  const phase=initialPhase(), secondary=[];
  let locked=false, primary, backend, lost=false, ending=false, priorPath, priorTimeout;
  const previous=sql.options.onclose;
  const onclose=(id) => {
    if (!ending) {
      lost=true; ending=true;
      // End the native driver immediately, so queued work cannot reconnect and continue.
      void sql.end({ timeout: 0 }).catch((error) => secondary.push({ stage: 'fatal-close', error }));
    }
    if (previous) { try { previous(id); } catch (error) { secondary.push({ stage: 'onclose', error }); } }
  };
  sql.options.onclose=onclose;
  const identity=async () => {
    if (lost) throw Object.assign(new Error('Direct migration session lost'), { code: 'CONNECTION_CLOSED' });
    const [row]=await sql`SELECT pg_backend_pid() AS pid, current_setting('search_path') AS path, current_setting('lock_timeout') AS timeout`;
    if (backend===undefined) {priorPath=row.path;priorTimeout=row.timeout;}
    if (backend!==undefined && row.pid!==backend) {
      lost=true; ending=true; await sql.end({ timeout: 0 });
      throw Object.assign(new Error('Direct migration session replaced'), { code: 'CONNECTION_CLOSED' });
    }
    backend=row.pid;
  };
  try {
    await identity();
    phase.baseline='unresolved';
    const baseline=await prepareDatabase(sql);
    phase.baseline=baseline.baseline ? 'committed' : 'existing';
    await identity();
    await sql`SET lock_timeout = '10s'`;
    await sql`SET search_path = public`;
    await verifyPublicSearchPath(sql);
    await sql`SELECT pg_advisory_lock(hashtext(${LOCK_NAME}))`;
    locked=true;
    await identity();
    const { rows }=await databaseState(sql), migrations=migrationPlan();
    assertKnownJournal(rows,migrations);
    const tail=migrations.find((entry) => entry.idx===38);
    if (rows.some((row) => row.hash===tail.hash)) await verifyHostedTextMigration(sql);
    if (Number(rows.at(-1).created_at)>=migrations[37].folderMillis) await verifySlugIndex(sql);
    await identity();
    await archiveLegacyPublicTables(sql);
    await identity();
    phase.tail='commit_unresolved';
    await migrate(drizzle(sql), { migrationsFolder });
    phase.tail='committed';
    await identity();
    await verifyHostedTextMigration(sql);
    phase.catalog='verified';
    phase.outcome='CATALOG_VERIFIED';
  } catch (error) {
    primary=error;
    if (connectionUnknown(error)) {
      lost=true; ending=true;
      try { await sql.end({timeout:0}); } catch (close) { secondary.push({stage:'fatal-close',error:close}); }
    }
    if (phase.baseline==='unresolved') phase.baseline=connectionUnknown(error) ? 'unknown' : 'not_committed';
    if (phase.tail==='committed') { phase.catalog='failed'; phase.outcome='COMMITTED_UNVERIFIED'; }
    else if (lost || connectionUnknown(error)) phase.outcome='UNKNOWN';
    else { if (phase.tail==='commit_unresolved') phase.tail='rolled_back'; phase.outcome='NOT_COMMITTED'; }
  } finally {
    const cleanupFailure=(stage,error) => { if (primary) secondary.push({stage,error}); else primary=error; phase.cleanup='failed'; };
    if (!lost) {
      if (locked) {
        try {
          await identity();
          const [row]=await sql`SELECT pg_advisory_unlock(hashtext(${LOCK_NAME})) AS released`;
          if (!row.released) throw new Error('Advisory lock release not confirmed');
        } catch (error) { cleanupFailure('unlock',error); }
      }
      if (!lost && priorTimeout!==undefined) { try { await sql`SELECT set_config('lock_timeout',${priorTimeout},false)`; } catch (error) { cleanupFailure('reset',error); } }
      if (!lost && priorPath!==undefined) { try { await sql`SELECT set_config('search_path',${priorPath},false)`; } catch (error) { cleanupFailure('search-path',error); } }
    } else phase.cleanup='failed';
    if (sql.options.onclose===onclose) sql.options.onclose=previous;
    if (phase.cleanup!=='failed') phase.cleanup='complete';
  }
  if (primary || lost) {
    if (phase.tail==='committed' && phase.catalog==='verified') phase.outcome='COMMITTED_CLEANUP_FAILED';
    throw new MigrationPhaseError(phase,primary ?? new Error('Direct session lost'),secondary);
  }
  return { status: 'catalog-verified', migrations: migrationPlan().length, phase };
}

async function main() {
  if (!process.env.DATABASE_URL) nextEnv.loadEnvConfig(projectDir);
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  const sql=createMigrationClient(process.env.DATABASE_URL);
  let result, primary;
  try { result=await migratePlatform(sql); } catch (error) { primary=error; }
  result=await closeMigrationClient(sql,result,primary);
  console.log(`[migrate:platform] ${JSON.stringify({ ...result,status:'complete' })}`);
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`[migrate:platform] ${safeFailure(error)}`); process.exitCode=1; });
}
