// @vitest-environment jsdom

import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentTimeMarker } from "./current-time-marker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CurrentTimeMarker", () => {
  it("hydrates from the same empty clock markup across midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 30));

    const currentDate = new Date(2026, 9, 20, 0, 0);
    const serverMarkup = renderToString(
      <CurrentTimeMarker currentDate={currentDate} />,
    );
    expect(serverMarkup).toBe("");

    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    vi.setSystemTime(new Date(2026, 9, 20, 0, 0, 30));

    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <CurrentTimeMarker currentDate={currentDate} />,
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.querySelector('[data-testid="current-time-marker"]')).not.toBeNull();
    await act(async () => root?.unmount());
  });

  it("uses the custom header offset, updates each minute, and stops after unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 20));

    const { unmount } = render(
      <CurrentTimeMarker currentDate={new Date(2026, 9, 19)} headerOffsetPx={90} />,
    );
    const marker = screen.getByTestId("current-time-marker");
    const expectedTopAt1020 = 90 + (4 + 20 / 60) * 80;
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(expectedTopAt1020);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(expectedTopAt1020 + 80 / 60);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves the marker off the previous day when the clock crosses midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59));

    const { rerender } = render(
      <CurrentTimeMarker currentDate={new Date(2026, 9, 19)} />,
    );
    expect(screen.getByTestId("current-time-marker")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId("current-time-marker")).toBeNull();

    rerender(<CurrentTimeMarker currentDate={new Date(2026, 9, 20)} />);
    expect(screen.getByTestId("current-time-marker")).toBeTruthy();
  });
});
