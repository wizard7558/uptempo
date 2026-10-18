// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingDemoOptions } from "@/lib/marketing/demo-options";
import { BookingDemo } from "./booking-demo";

// The picker is a separate lazy chunk; stand in for it here.
vi.mock("./booking-demo-step", () => ({
  default: ({ industry }: { industry: string }) => <p>Picker for {industry}</p>,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const t = (key: string) => key;
const options = bookingDemoOptions(t, new Date("2026-10-12T12:00:00Z"));

function renderDemo() {
  // No NextIntlClientProvider on purpose: the demo's frame takes its text as props.
  return render(<BookingDemo options={options} switcherLabel="Show a sample for" note="This is a sample." />);
}

describe("bookingDemoOptions", () => {
  it("translates the business and heading on the server", () => {
    expect(options[0]).toMatchObject({
      id: "barber",
      business: "demo.business.barber",
      heading: "demo.heading.barber",
    });
  });
});

describe("BookingDemo", () => {
  it("renders its frame from props without a translation provider", () => {
    renderDemo();
    expect(screen.getByRole("heading", { name: "demo.heading.barber" })).toBeTruthy();
    expect(screen.getByText("demo.business.barber")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Show a sample for" })).toBeTruthy();
    expect(screen.getByText("This is a sample.")).toBeTruthy();
  });

  it("switches industry when a button is pressed", async () => {
    const user = userEvent.setup();
    renderDemo();
    await user.click(screen.getByRole("button", { name: options[1].label }));
    expect(screen.getByRole("heading", { name: "demo.heading.nail_salon" })).toBeTruthy();
    expect(screen.getByRole("button", { name: options[1].label }).getAttribute("aria-pressed")).toBe("true");
  });

  it("loads the picker once the browser is idle, not with the first render", async () => {
    vi.useFakeTimers();
    renderDemo();
    expect(screen.queryByText(/Picker for/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    vi.useRealTimers();
    expect(await screen.findByText("Picker for barber")).toBeTruthy();
  });
});
