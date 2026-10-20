// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScheduleData } from "@/actions/appointments";
import { DayView } from "./day-view";

vi.mock("@/actions/appointments", () => ({
  getRoomDay: vi.fn(),
  getScheduleData: vi.fn(),
}));
vi.mock("@/actions/assistant-tasks", () => ({
  listTasksForAssistants: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/terms/client", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./current-time-marker", () => ({ CurrentTimeMarker: () => null }));
vi.mock("./resource-column", () => ({ ResourceColumn: () => null }));
vi.mock("./staff-column", () => ({ StaffColumn: () => null }));
vi.mock("./time-column", () => ({ TimeColumn: () => null }));

type ScheduleResult = Awaited<ReturnType<typeof getScheduleData>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ScheduleErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div role="alert">Schedule load failed</div>;
    }
    return this.props.children;
  }
}

const emptySchedule: ScheduleResult = {
  appointments: {},
  externalEvents: {},
  timeBlocks: {},
};

function createDayView(
  currentDate = new Date("2026-10-19T12:00:00Z"),
  staff = [{ id: "staff-1", displayName: "Staff member" }],
) {
  return (
    <DayView
      staff={staff}
      currentDate={currentDate}
      onSlotClick={vi.fn()}
      onAppointmentSelect={vi.fn()}
      onDragReschedule={vi.fn()}
    />
  );
}

beforeEach(() => vi.mocked(getScheduleData).mockReset());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DayView schedule data readiness", () => {
  it("stays busy while loading and only marks the current resolved result ready", async () => {
    const first = deferred<ScheduleResult>();
    const second = deferred<ScheduleResult>();
    vi.mocked(getScheduleData)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    try {
      const view = render(createDayView());
      const region = screen.getByTestId("day-grid-scroll");

      await waitFor(() => expect(getScheduleData).toHaveBeenCalledTimes(1));
      expect(region.getAttribute("data-schedule-data-ready")).toBe("false");
      expect(region.getAttribute("aria-busy")).toBe("true");

      view.rerender(createDayView(new Date("2026-10-20T12:00:00Z")));
      await waitFor(() => expect(getScheduleData).toHaveBeenCalledTimes(2));
      expect(region.getAttribute("data-schedule-data-ready")).toBe("false");
      expect(region.getAttribute("aria-busy")).toBe("true");

      await act(async () => first.resolve(emptySchedule));
      expect(region.getAttribute("data-schedule-data-ready")).toBe("false");

      await act(async () => second.resolve(emptySchedule));
      await waitFor(() =>
        expect(region.getAttribute("data-schedule-data-ready")).toBe("true"),
      );
      expect(region.getAttribute("aria-busy")).toBe("false");
    } finally {
      await act(async () => {
        first.resolve(emptySchedule);
        second.resolve(emptySchedule);
      });
    }
  });

  it("marks the legitimate empty-staff result ready without an action request", async () => {
    render(createDayView(new Date("2026-10-19T12:00:00Z"), []));
    const region = screen.getByTestId("day-grid-scroll");

    await waitFor(() =>
      expect(region.getAttribute("data-schedule-data-ready")).toBe("true"),
    );
    expect(region.getAttribute("aria-busy")).toBe("false");
    expect(getScheduleData).not.toHaveBeenCalled();
  });

  it("never marks a rejected schedule request ready", async () => {
    const failed = deferred<ScheduleResult>();
    vi.mocked(getScheduleData).mockReturnValueOnce(failed.promise);

    render(
      <ScheduleErrorBoundary>{createDayView()}</ScheduleErrorBoundary>,
    );
    const region = screen.getByTestId("day-grid-scroll");

    await waitFor(() => expect(getScheduleData).toHaveBeenCalledTimes(1));
    expect(region.getAttribute("data-schedule-data-ready")).toBe("false");
    expect(region.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      failed.reject(new Error("schedule request rejected"));
      await Promise.resolve();
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Schedule load failed",
    );
    expect(region.getAttribute("data-schedule-data-ready")).toBe("false");
  });
});
