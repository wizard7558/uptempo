// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";

const sms = vi.hoisted(() => ({
  calls: [] as { to: string; body: string }[],
}));

vi.mock("@/lib/sms/send", () => ({
  sendSms: vi.fn(async (p: { to: string; body: string }) => {
    sms.calls.push({ to: p.to, body: p.body });
    if (p.to === "+15555550103") return { success: false, error: "no_consent" };
    return { success: true, messageSid: "log-test" };
  }),
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;
const tenants: { drop: () => Promise<void> }[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

describe("slot waitlist offers", () => {
  itDb(
    "texts the first consenting match, expires a missed hold, and stays quiet after 9 PM",
    async () => {
      const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
      const t = await scratchTenant("wl");
      tenants.push(t);
      const s = `"${t.schema}"`;
      const one = async (q: string) => (await t.run(q))[0];
      const id = async (q: string) => String((await one(q)).id);
      const range = (a: string, b: string) => `tstzrange('${a}','${b}','[)')`;

      const loc = await id(`select id from ${s}.locations order by created_at limit 1`);
      const s1 = await id(`insert into ${s}.staff (display_name) values ('S1') returning id`);
      const cut = await id(
        `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
      );
      await t.run(
        `insert into ${s}.staff_services (staff_id, service_id) values ('${s1}', '${cut}')`,
      );
      await t.run(
        `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id)
         values ('${s1}', 3, '09:00', '17:00', 1, '${loc}')`,
      );
      await t.run(
        `insert into ${s}.business_settings (timezone, same_day_booking, min_notice_minutes, waitlist_hold_minutes)
         values ('America/New_York', 1, 120, 15)`,
      );

      const c1 = await id(`insert into ${s}.clients (name, phone) values ('C1', '+15555550101') returning id`);
      const c2 = await id(`insert into ${s}.clients (name, phone) values ('C2', '+15555550102') returning id`);
      const c3 = await id(`insert into ${s}.clients (name, phone) values ('C3', '+15555550103') returning id`);
      const c9 = await id(`insert into ${s}.clients (name) values ('C9') returning id`);
      for (const [client, phone] of [
        [c1, "+15555550101"],
        [c2, "+15555550102"],
      ] as const) {
        await t.run(
          `insert into ${s}.sms_consent (client_id, phone, consented_at, consent_method, consent_source)
           values ('${client}', '${phone}', now(), 'waitlist_form', 'test')`,
        );
      }

      const during = range("2026-06-17T18:00:00Z", "2026-06-17T19:00:00Z");
      const x = await id(
        `insert into ${s}.appointments (staff_id, client_id, location_id, during, status)
         values ('${s1}', '${c9}', '${loc}', ${during}, 'cancelled') returning id`,
      );

      const w3 = await id(
        `insert into ${s}.slot_waitlist (client_id, service_ids, date_from, date_to, created_at)
         values ('${c3}', '["${cut}"]'::jsonb, '2026-06-17', '2026-06-17', '2026-06-01T00:00:00Z') returning id`,
      );
      const w1 = await id(
        `insert into ${s}.slot_waitlist (client_id, service_ids, staff_id, date_from, date_to, time_from, time_to, created_at)
         values ('${c1}', '["${cut}"]'::jsonb, '${s1}', '2026-06-16', '2026-06-18', '12:00', '17:00', '2026-06-01T00:01:00Z') returning id`,
      );
      await t.run(
        `insert into ${s}.slot_waitlist (client_id, service_ids, date_from, date_to, time_from, time_to, created_at)
         values ('${c2}', '["${cut}"]'::jsonb, '2026-06-17', '2026-06-20', '00:00', '12:00', '2026-06-01T00:02:00Z')`,
      );

      const now = new Date("2026-06-15T13:00:00Z");
      const { recordOpeningForCancelledAppointment, runWaitlistCron, markOfferBooked } = await import(
        "./opening"
      );
      sms.calls.length = 0;
      await recordOpeningForCancelledAppointment(t.slug, x, now);

      expect(sms.calls.map((c) => c.to)).toEqual(["+15555550103", "+15555550101"]);
      expect(sms.calls[1].body).toContain(`/book/${t.slug}/claim/`);
      expect(sms.calls[1].body).toContain("15 minutes");

      const offered = await one(
        `select status, offered_start, offered_end, offer_expires_at from ${s}.slot_waitlist where id = '${w1}'`,
      );
      expect(offered.status).toBe("offered");
      expect(new Date(String(offered.offered_start)).toISOString()).toBe("2026-06-17T18:00:00.000Z");
      expect(new Date(String(offered.offered_end)).toISOString()).toBe("2026-06-17T18:30:00.000Z");
      expect(new Date(String(offered.offer_expires_at)).toISOString()).toBe("2026-06-15T13:15:00.000Z");

      const waitingAgain = await one(`select status from ${s}.slot_waitlist where id = '${w3}'`);
      expect(waitingAgain.status).toBe("waiting");

      const opening = await one(
        `select status, attempts, offered_entry_ids from ${s}.waitlist_openings where appointment_id = '${x}'`,
      );
      expect(opening.status).toBe("offered");
      expect(Number(opening.attempts)).toBe(1);
      const offeredIds = Array.isArray(opening.offered_entry_ids)
        ? opening.offered_entry_ids
        : JSON.parse(String(opening.offered_entry_ids));
      expect(offeredIds).toEqual([w3, w1]);

      await runWaitlistCron(t.slug, new Date("2026-06-15T13:16:00Z"));
      expect(sms.calls).toHaveLength(2);
      const afterExpire = await one(
        `select status, missed_offers from ${s}.slot_waitlist where id = '${w1}'`,
      );
      expect(afterExpire.status).toBe("waiting");
      expect(Number(afterExpire.missed_offers)).toBe(1);
      const closed = await one(
        `select status from ${s}.waitlist_openings where appointment_id = '${x}'`,
      );
      expect(closed.status).toBe("closed");

      const y = await id(
        `insert into ${s}.appointments (staff_id, client_id, location_id, during, status)
         values ('${s1}', '${c9}', '${loc}', ${during}, 'cancelled') returning id`,
      );
      await recordOpeningForCancelledAppointment(t.slug, y, now);
      expect(sms.calls).toHaveLength(4);
      expect(sms.calls[3].to).toBe("+15555550101");

      const { checkBooking } = await import("@/lib/scheduling/service");
      const guard = await checkBooking({
        slug: t.slug,
        staffId: s1,
        start: new Date("2026-06-17T18:00:00.000Z"),
        services: [{ serviceId: cut, durationMinutes: 30 }],
        totalMinutes: 30,
        locationId: loc,
        mode: "public",
        clientId: c1,
        ignoreHoldIds: [w1],
        now,
      });
      expect(guard).toEqual({ ok: true, resources: [] });

      const { bookAppointment } = await import("@/lib/booking/book");
      const booked = await bookAppointment({
        slug: t.slug,
        staffId: s1,
        clientId: c1,
        serviceIds: [cut],
        start: new Date("2026-06-17T18:00:00.000Z"),
        locationId: loc,
        mode: "public",
        ignoreHoldIds: [w1],
        now,
      });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;
      await markOfferBooked(t.slug, w1, booked.id, now);
      const bookedRow = await one(`select status, booked_appointment_id from ${s}.slot_waitlist where id = '${w1}'`);
      expect(bookedRow.status).toBe("booked");
      expect(bookedRow.booked_appointment_id).toBe(booked.id);
      const filled = await one(`select status from ${s}.waitlist_openings where appointment_id = '${y}'`);
      expect(filled.status).toBe("filled");

      const quietNow = new Date("2026-06-15T02:00:00Z");
      const z = await id(
        `insert into ${s}.appointments (staff_id, client_id, location_id, during, status)
         values ('${s1}', '${c9}', '${loc}', ${during}, 'cancelled') returning id`,
      );
      const beforeQuiet = sms.calls.length;
      await recordOpeningForCancelledAppointment(t.slug, z, quietNow);
      expect(sms.calls).toHaveLength(beforeQuiet);
      const quiet = await one(`select status from ${s}.waitlist_openings where appointment_id = '${z}'`);
      expect(quiet.status).toBe("open");
    },
    120_000,
  );
});
