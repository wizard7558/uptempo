// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Slider } from "./slider";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback(
          [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Slider", () => {
  it("exposes a single thumb label to assistive technology", () => {
    render(<Slider defaultValue={[40]} thumbLabels={["Demo value"]} />);

    expect(screen.getByRole("slider", { name: "Demo value" })).toBeTruthy();
  });

  it("gives each range thumb its own accessible name", () => {
    render(
      <Slider
        defaultValue={[25, 75]}
        thumbLabels={["Minimum value", "Maximum value"]}
      />,
    );

    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(screen.getByRole("slider", { name: "Minimum value" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Maximum value" })).toBeTruthy();
  });

  it("forwards root aria-label and aria-labelledby to each thumb", () => {
    const { unmount } = render(
      <Slider defaultValue={[20, 80]} aria-label="Volume range" />,
    );
    expect(screen.getAllByRole("slider", { name: "Volume range" })).toHaveLength(2);
    unmount();

    render(
      <>
        <span id="range-label">Playback range</span>
        <Slider defaultValue={[20, 80]} aria-labelledby="range-label" />
      </>,
    );
    expect(
      screen.getAllByRole("slider", { name: "Playback range" }),
    ).toHaveLength(2);
  });
});
