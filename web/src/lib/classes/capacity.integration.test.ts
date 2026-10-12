// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { pgErrorInfo } from "@/lib/db/pg-error";

const itDb = process.env.DATABASE_URL ? it : it.skip;

type Scratch = Awaited<ReturnType<typeof import("@/lib/scheduling/db-fixtures").scratchTenant>>;
const tenants: Scratch[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

async function setup(tag: string, capacity: number, waitlistCapacity = 10) {
  const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
  const t = await scratchTenant(tag);
  tenants.push(t);
  const S = t.schema;
  const [svc] = await t.run(
    `INSERT INTO "${S}".services (name, default_duration_minutes, price_cents, is_class, class_capacity)
     VALUES ('Bootcamp', 45, 2000, 1, ${capacity}) RETURNING id`,
  );
  const [staff] = await t.run(`INSERT INTO "${S}".staff (display_name) VALUES ('Coach') RETURNING id`);
  const [session] = await t.run(
    `INSERT INTO "${S}".class_sessions (service_id, staff_id, during, capacity, waitlist_capacity)
     VALUES ('${svc.id}', '${staff.id}', tstzrange('2031-01-07T15:00Z','2031-01-07T16:00Z','[)'), ${capacity}, ${waitlistCapacity})
     RETURNING id`,
  );
  const client = async (n: number) => {
    const [c] = await t.run(
      `INSERT INTO "${S}".clients (name, email) VALUES ('C${n}', 'c${n}-${Date.now()}@example.com') RETURNING id`,
    );
    return c.id as string;
  };
  const enroll = (clientId: string, status = "booked") =>
    t.run(
      `INSERT INTO "${S}".class_enrollments (session_id, client_id, status) VALUES ('${session.id}', '${clientId}', '${status}') RETURNING id, waitlist_position`,
    );
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return pgErrorInfo(e);
    }
    throw new Error("Expected the statement to fail");
  };
  return { t, S, session: session.id as string, client, enroll, fails };
}

describe("class capacity (integration)", () => {
  itDb("rejects the third booking in a capacity 2 class", async () => {
    const x = await setup("cap2", 2);
    await x.enroll(await x.client(1));
    await x.enroll(await x.client(2));
    const err = await x.fails(x.enroll(await x.client(3)));
    expect(err).toEqual({ code: "23P01", constraint: "class_enrollments_capacity" });
  }, 120_000);

  itDb("race: two concurrent inserts into a capacity 1 class, exactly one wins", async () => {
    const x = await setup("race", 1);
    const [c1, c2] = [await x.client(1), await x.client(2)];
    const results = await Promise.allSettled([x.enroll(c1), x.enroll(c2)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(pgErrorInfo(bad[0].reason)).toEqual({ code: "23P01", constraint: "class_enrollments_capacity" });
    const [n] = await x.t.run(
      `SELECT count(*)::int AS n FROM "${x.S}".class_enrollments WHERE session_id = '${x.session}' AND status = 'booked'`,
    );
    expect(n.n).toBe(1);
  }, 120_000);

  itDb("numbers the waitlist 1, 2 and then reports it full", async () => {
    const x = await setup("wl", 1, 2);
    await x.enroll(await x.client(1));
    const [w1] = await x.enroll(await x.client(2), "waitlisted");
    const [w2] = await x.enroll(await x.client(3), "waitlisted");
    expect(w1.waitlist_position).toBe(1);
    expect(w2.waitlist_position).toBe(2);
    const err = await x.fails(x.enroll(await x.client(4), "waitlisted"));
    expect(err).toEqual({ code: "23P01", constraint: "class_enrollments_waitlist_full" });
  }, 120_000);

  itDb("rejects the same client twice while active", async () => {
    const x = await setup("dup", 5);
    const c = await x.client(1);
    await x.enroll(c);
    const err = await x.fails(x.enroll(c));
    expect(err).toEqual({ code: "23505", constraint: "class_enrollments_active_unique" });
  }, 120_000);

  itDb("rejects enrolling in a cancelled session", async () => {
    const x = await setup("closed", 5);
    await x.t.run(`UPDATE "${x.S}".class_sessions SET status = 'cancelled' WHERE id = '${x.session}'`);
    const err = await x.fails(x.enroll(await x.client(1)));
    expect(err.constraint).toBe("class_enrollments_session_open");
  }, 120_000);

  itDb("promoting a waitlisted row fails when full and works after a cancellation", async () => {
    const x = await setup("promo", 1, 5);
    const [booked] = await x.enroll(await x.client(1));
    const [wait] = await x.enroll(await x.client(2), "waitlisted");
    const promote = () =>
      x.t.run(
        `UPDATE "${x.S}".class_enrollments SET status = 'booked', waitlist_position = NULL, promoted_at = now() WHERE id = '${wait.id}'`,
      );
    expect(await x.fails(promote())).toEqual({ code: "23P01", constraint: "class_enrollments_capacity" });
    await x.t.run(
      `UPDATE "${x.S}".class_enrollments SET status = 'cancelled', cancelled_at = now() WHERE id = '${booked.id}'`,
    );
    await promote();
    const [row] = await x.t.run(
      `SELECT status, waitlist_position FROM "${x.S}".class_enrollments WHERE id = '${wait.id}'`,
    );
    expect(row).toMatchObject({ status: "booked", waitlist_position: null });
  }, 120_000);

  itDb("updating non-status columns on a full session does not trip the trigger", async () => {
    const x = await setup("upd", 1);
    const [booked] = await x.enroll(await x.client(1));
    await x.t.run(
      `UPDATE "${x.S}".class_enrollments SET checked_in_at = now() WHERE id = '${booked.id}'`,
    );
    // Same status written again is also a no-op for the guard.
    await x.t.run(`UPDATE "${x.S}".class_enrollments SET status = 'booked' WHERE id = '${booked.id}'`);
    const [row] = await x.t.run(
      `SELECT status, checked_in_at FROM "${x.S}".class_enrollments WHERE id = '${booked.id}'`,
    );
    expect(row.status).toBe("booked");
    expect(row.checked_in_at).not.toBeNull();
  }, 120_000);
});
