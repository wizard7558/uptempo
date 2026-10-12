import { describe, expect, it } from "vitest";
import { prepareManualSms } from "@/lib/sms/plain-text";
import { applyCheckIn } from "./check-in";

const AT_CAP =
  "Please arrive a few minutes early and check in at the desk. We will text you if the time moves. Bring a photo of the look you want, and leave extra time for parking on the street behind the building. See you soon. Reply if you need to change the time or the service before you come in today. Ask at the desk. We see you.";

describe("check-in timestamp", () => {
  it("keeps the first time when staff check in again", () => {
    const first = applyCheckIn(null, new Date("2026-10-12T15:04:00.000Z"));
    expect(first.changed).toBe(true);
    expect(first.at.toISOString()).toBe("2026-10-12T15:04:00.000Z");

    const second = applyCheckIn(first.at, new Date("2026-10-12T16:10:00.000Z"));
    expect(second.changed).toBe(false);
    expect(second.at.toISOString()).toBe("2026-10-12T15:04:00.000Z");
  });
});

describe("manual text length", () => {
  it("keeps a 320 character message and refuses one more character", () => {
    expect(prepareManualSms(AT_CAP)).toEqual({ ok: true, body: AT_CAP });
    expect(prepareManualSms(`${AT_CAP}x`)).toEqual({ ok: false, error: "too_long" });
  });

  it("strips smart quotes before measuring the message", () => {
    expect(prepareManualSms("See you “soon”")).toEqual({
      ok: true,
      body: 'See you "soon"',
    });
  });
});
