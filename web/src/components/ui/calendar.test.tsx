// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Calendar } from "./calendar";

afterEach(() => {
  cleanup();
});

describe("Calendar selection state", () => {
  const month = new Date(2026, 5, 1);
  const rangeStart = new Date(2026, 5, 10);
  const rangeEnd = new Date(2026, 5, 12);
  const disabledDay = new Date(2026, 5, 15);

  it("keeps range boundaries, middle days, and disabled dates distinct", () => {
    const { container } = render(
      <Calendar
        mode="range"
        defaultMonth={month}
        selected={{ from: rangeStart, to: rangeEnd }}
        disabled={disabledDay}
      />,
    );

    expect(
      container.querySelector('button[data-range-start="true"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container.querySelector('button[data-range-middle="true"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container.querySelector('button[data-range-end="true"]')?.getAttribute("aria-pressed"),
    ).toBe("true");

    const disabledButton = container.querySelector<HTMLButtonElement>("button[data-day][disabled]");
    expect(disabledButton).not.toBeNull();
    expect(disabledButton?.disabled).toBe(true);
    expect(disabledButton?.hasAttribute("data-range-start")).toBe(false);
    expect(disabledButton?.hasAttribute("data-range-middle")).toBe(false);
    expect(disabledButton?.hasAttribute("data-range-end")).toBe(false);

  });

  it("exposes the selected single day and preserves disabled dates", () => {
    const { container } = render(
      <Calendar
        mode="single"
        defaultMonth={month}
        selected={rangeStart}
        disabled={disabledDay}
      />,
    );
    const selectedButton = container.querySelector('button[data-selected-single="true"]');
    expect(selectedButton).not.toBeNull();
    expect(selectedButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("button[data-day][disabled]")?.disabled).toBe(true);
  });
});
