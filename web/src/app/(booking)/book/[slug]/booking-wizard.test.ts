import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en.json";

vi.mock("@/actions/booking-public", () => ({
  servicesNeedAddress: vi.fn(),
  recheckPublicSlot: vi.fn(),
}));
vi.mock("@/actions/stripe", () => ({ getClientPaymentMethod: vi.fn() }));
vi.mock("@/lib/analytics/posthog-provider", () => ({ trackClientEvent: vi.fn() }));
vi.mock("@/lib/terms/client", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/booking-public/progress-bar", () => ({ ProgressBar: () => null }));
vi.mock("@/components/booking-public/service-step", () => ({ ServiceStep: () => null }));
vi.mock("@/components/booking-public/time-step", () => ({ TimeStep: () => null }));
vi.mock("@/components/booking-public/details-step", () => ({ DetailsStep: () => null }));
vi.mock("@/components/booking-public/confirm-pay-step", () => ({ ConfirmPayStep: () => null }));
vi.mock("@/components/booking-public/success-view", () => ({ SuccessView: () => null }));

import { bookingReducer, createInitialState, SLOT_NO_LONGER_FITS_MESSAGE } from "./booking-wizard";

const pickService = (needsAddress: boolean, from = createInitialState(null)) =>
  bookingReducer(from, {
    type: "SET_SERVICE",
    staffId: "s1",
    staffName: "Sam",
    serviceIds: ["svc"],
    serviceSummary: "Clean",
    totalDuration: 60,
    needsAddress,
  });

describe("booking wizard steps", () => {
  it("moves service, time, details, then confirm", () => {
    const start = createInitialState(null);
    expect(start.currentStep).toBe("service");

    const timed = pickService(false, start);
    expect(timed.currentStep).toBe("time");
    expect(timed.needsAddress).toBe(false);
    expect(timed.serviceAddressId).toBeNull();

    const picked = bookingReducer(timed, {
      type: "SET_TIME",
      date: "2026-06-17",
      time: "2026-06-17T14:00:00.000Z",
    });
    expect(picked.currentStep).toBe("details");

    const named = bookingReducer(picked, {
      type: "SET_CLIENT",
      clientId: "c1",
      clientName: "Ana",
      clientPhone: "+15555550100",
    });
    expect(named.currentStep).toBe("confirm");
    expect(named.clientName).toBe("Ana");
  });

  it("opens a prefilled visit on time before anyone signs in", () => {
    const prefilled = createInitialState(null, { staffId: "s1", serviceIds: ["svc"] });
    expect(prefilled.currentStep).toBe("time");
    expect(prefilled.needsAddress).toBeNull();
    expect(prefilled.completedSteps).toContain("service");
    expect(prefilled.clientId).toBeNull();
  });

  it("keeps a signed-in client on the prefilled time step", () => {
    const prefilled = createInitialState(
      { clientId: "c1", clientName: "Ana" },
      { staffId: "s1", serviceIds: ["svc"] },
    );
    expect(prefilled.currentStep).toBe("time");
    expect(prefilled.clientId).toBe("c1");
    expect(prefilled.clientName).toBe("Ana");
    expect(prefilled.needsAddress).toBeNull();
  });

  it("returns to time when the slot no longer fits", () => {
    let state = createInitialState({ clientId: "c1", clientName: "Ana" });
    expect(state.currentStep).toBe("service");
    state = pickService(false, state);
    state = bookingReducer(state, {
      type: "SET_TIME",
      date: "2026-06-17",
      time: "2026-06-17T14:00:00.000Z",
    });
    state = bookingReducer(state, {
      type: "ACK_CLIENT",
    });
    expect(state.currentStep).toBe("confirm");

    const back = bookingReducer(state, { type: "SLOT_NO_LONGER_FITS" });
    expect(back.currentStep).toBe("time");
    expect(back.selectedTime).toBeNull();
    expect(back.clientId).toBe("c1");
    expect(back.timeNotice).toBe("That time no longer fits your visit. Pick another time.");
    expect(back.timeNotice).toBe(SLOT_NO_LONGER_FITS_MESSAGE);
    expect(back.completedSteps).toContain("service");
    expect(back.completedSteps).not.toContain("time");
    expect(back.completedSteps).not.toContain("confirm");
  });

  it("stores the fallback sentence in the booking copy", () => {
    expect(messages.booking.wizard.slotMismatch).toBe(
      "That time no longer fits your visit. Pick another time.",
    );
  });

  it("asks for an address on the time step and drops a time picked for another address", () => {
    let state = pickService(true);
    expect(state.currentStep).toBe("time");
    expect(state.needsAddress).toBe(true);
    state = bookingReducer(state, { type: "SET_ADDRESS", addressId: "addr1" });
    expect(state.serviceAddressId).toBe("addr1");
    expect(state.currentStep).toBe("time");
    state = bookingReducer(state, { type: "SET_LOCATION", locationId: "l1", locationName: "Studio" });
    state = bookingReducer(state, {
      type: "SET_TIME",
      date: "2026-06-17",
      time: "2026-06-17T14:00:00.000Z",
    });
    expect(state.currentStep).toBe("details");
    const moved = bookingReducer(state, { type: "SET_ADDRESS", addressId: "addr2" });
    expect(moved.selectedTime).toBeNull();
    expect(moved.currentStep).toBe("time");
    expect(moved.completedSteps).not.toContain("time");
    expect(moved.completedSteps).not.toContain("confirm");
  });

  it("clears the saved address when the services change", () => {
    const withAddress = bookingReducer(pickService(true), { type: "SET_ADDRESS", addressId: "addr1" });
    expect(pickService(true, withAddress).serviceAddressId).toBeNull();
    expect(pickService(false, withAddress).needsAddress).toBe(false);
  });
});
