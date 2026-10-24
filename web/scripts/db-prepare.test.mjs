import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { migratePlatform } from "./migrate-platform.mjs";
import { bootstrapPlan, migrationPlan, assertKnownJournal, safeFailure, MigrationPhaseError, directMigrationUrl, closeMigrationClient } from "./db-prepare.mjs";

describe("fixed public bootstrap boundary", () => {
  it("uses the complete 0037 checkpoint and leaves the SQL-owned 0038 objects to the actual tail", async () => {
    const plan = await bootstrapPlan();
    expect(Object.keys(plan.snapshot.tables)).toHaveLength(16);
    expect(plan.statements.filter((sql) => sql.startsWith('CREATE TABLE'))).toHaveLength(16);
    expect(plan.statements.join('\n')).toContain('CREATE UNIQUE INDEX "tenants_slug_unique"');
    expect(plan.statements.join('\n')).not.toContain('hosted_text_billing_state');
    expect(plan.statements.join('\n')).not.toContain('hosted_text_preserve_report_facts');
    expect(plan.migrations.map((entry) => entry.idx)).toEqual(Array.from({ length: 38 }, (_, i) => i));
    for (const entry of plan.migrations) {
      expect(entry.hash).toBe(createHash('sha256').update(readFileSync(`drizzle/${entry.tag}.sql`)).digest('hex'));
    }
    expect(migrationPlan().at(-1).idx).toBe(38);
  });
  it("rejects unjournaled, modified, unknown, duplicate, skipped, or reordered history", () => {
    const entries = migrationPlan();
    const rows = entries.map((entry) => ({ hash: entry.hash, created_at: entry.folderMillis }));
    expect(() => assertKnownJournal(rows)).not.toThrow();
    expect(() => assertKnownJournal(rows.slice(0, 26))).not.toThrow();
    for (const changed of [[], [{ hash: 'unknown', created_at: 0 }], [...rows, rows[0]],
      [rows[1], rows[0]], [rows[0], rows[2]], [{ ...rows[0], hash: 'modified' }]]) {
      expect(() => assertKnownJournal(changed)).toThrow('reconciliation required');
    }
  });
  it("imports both entrypoints without connecting, running migrations, or loading env files", () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `await import('./scripts/db-prepare.mjs'); await import('./scripts/migrate-platform.mjs');`],
    { env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS }, encoding: 'utf8' });
    expect(child.status).toBe(0);
    expect(child.stdout).toBe('');
    expect(child.stderr).toBe('');
  });
  it("does not trust a native error that spoofs the reconciliation message prefix", () => {
    const privateUrl = 'postgres://synthetic-private:synthetic-password@private-host/db';
    const native = Object.assign(new Error(`Database reconciliation required: ${privateUrl}`), { code: 'P0001' });
    expect(safeFailure(native)).not.toContain(privateUrl);
    expect(safeFailure(native)).toContain('P0001');
  });
  it("does not claim a committed baseline from a forged native error message", () => {
    const native = Object.assign(new Error('Baseline 0037 committed; subsequent SQL failed'), { code: 'P0001' });
    expect(safeFailure(native)).not.toContain('Baseline through 0037 committed');
    expect(safeFailure(native)).toContain('No completion claimed');
  });
  it("reports actual typed reconciliation and baseline failures while retaining the native cause code", () => {
    let reconciliation;
    try { assertKnownJournal([]); } catch (error) { reconciliation = error; }
    expect(safeFailure(reconciliation)).toContain('Database reconciliation required: existing database');
    const native = Object.assign(new Error('postgres://synthetic-private:synthetic-password@private-host/db'), { code: '42830' });
    const failure = new MigrationPhaseError({ baseline: 'committed', tail: 'rolled_back', catalog: 'unverified', cleanup: 'complete', clientClose: 'pending', outcome: 'ROLLED_BACK' }, new Error('wrapper', { cause: native }));
    expect(failure.cause.cause).toBe(native);
    expect(safeFailure(failure)).toContain('baseline=committed');
    expect(safeFailure(failure)).toContain('42830');
    expect(safeFailure(failure)).not.toContain('postgres://');
    expect(safeFailure(failure)).toContain('No completion claimed');
  });
  it("never logs raw native errors, SQL, or connection URLs", () => {
    const secret = 'postgres://sensitive-user:sensitive-password@private-host/db';
    expect(safeFailure({ message: secret, cause: { code: '42830', message: secret } })).toContain('42830');
    expect(safeFailure({ message: secret })).not.toContain(secret);
    expect(safeFailure({ cause: { code: secret } })).not.toContain(secret);
  });
  it("selects only the documented same-endpoint Neon AWS direct hostname and preserves URL bytes", () => {
    for (const host of ['ep-blue-11-pooler.us-east-2.aws.neon.tech', 'ep-blue-11-pooler.c-2.eu-central-1.aws.neon.tech']) {
      const value=`postgresql://user%40example:p%2F%3A%2B@${host}:5432/my%2Fdb?sslmode=require&options=Case%20Sensitive`;
      expect(directMigrationUrl(value)).toBe(value.replace('-pooler.','.'));
    }
    for (const value of ['postgres://user@127.0.0.1:5432/db?sslmode=disable', 'postgresql://u@ep-blue-11.us-east-2.aws.neon.tech/db']) {
      expect(directMigrationUrl(value)).toBe(value);
    }
    for (const host of ['ep-blue-pooler.us-east-2.aws.neon.tech.attacker.example', 'ep-blue-pooler.eu-central-1.azure.neon.tech',
      'db.pooler.example', 'pgbouncer.example', 'ep-blue-pooler.c-x.us-east-2.aws.neon.tech', 'host1,host2']) {
      expect(() => directMigrationUrl(`postgres://synthetic@${host}/db`)).toThrow('reconciliation required');
    }
  });
  it("rejects imported pooled, rotating, multihost, or concurrent clients before executing SQL", async () => {
    for (const patch of [{host:['ep-blue-pooler.us-east-2.aws.neon.tech']}, {host:['pgbouncer.example']},
      {host:['127.0.0.1','127.0.0.2']}, {max:2}, {idle_timeout:1}, {max_lifetime:10}]) {
      let calls=0;
      const sql=Object.assign(() => { calls++; throw new Error('Unexpected SQL'); },
        {options:{max:1,host:['127.0.0.1'],idle_timeout:0,max_lifetime:0,...patch}});
      await expect(migratePlatform(sql)).rejects.toThrow('reconciliation required');
      expect(calls).toBe(0);
    }
  });
  it("marks acknowledged successful close complete while rethrowing the identical primary failure", async () => {
    const cause=new Error('original operation failure');
    const secondary=[{stage:'unlock',error:new Error('original cleanup failure')}];
    const phase={baseline:'committed',tail:'committed',catalog:'failed',cleanup:'failed',clientClose:'pending',outcome:'COMMITTED_UNVERIFIED'};
    const primary=new MigrationPhaseError(phase,cause,secondary);
    const closeCalls=[];
    const sql={end:async (options) => {closeCalls.push(options);}};
    await expect(closeMigrationClient(sql,undefined,primary)).rejects.toBe(primary);
    expect(closeCalls).toEqual([{timeout:5}]);
    expect(primary.phase).toEqual({...phase,clientClose:'complete'});
    expect(primary.cause).toBe(cause);
    expect(primary.secondary).toBe(secondary);
    expect(primary.secondary).toHaveLength(1);
  });
  it("preserves confirmed commit state and primary causes when closing the client fails", async () => {
    const native=Object.assign(new Error('synthetic-private-native-message'),{code:'P0001'});
    const phase={baseline:'committed',tail:'committed',catalog:'verified',cleanup:'complete',clientClose:'pending',outcome:'CATALOG_VERIFIED'};
    const sql={end:async () => {throw native;}};
    let failure;
    try { await closeMigrationClient(sql,{phase}); } catch (error) { failure=error; }
    expect(failure.phase).toMatchObject({tail:'committed',catalog:'verified',clientClose:'failed'});
    expect(failure.cause).toBe(native);
    expect(safeFailure(failure)).not.toContain(native.message);
    const primary=new MigrationPhaseError({...phase,catalog:'failed',outcome:'COMMITTED_UNVERIFIED'},new Error('primary'));
    await expect(closeMigrationClient(sql,{phase},primary)).rejects.toBe(primary);
    expect(primary.cause.message).toBe('primary');
    expect(primary.secondary[0]).toEqual({stage:'close',error:native});
  });

});
