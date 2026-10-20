// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const startPostHog = vi.fn();
vi.mock("./posthog-provider", () => ({ startPostHog }));

import { PostHogLazy } from "./posthog-lazy";

afterEach(cleanup);

describe("PostHogLazy", () => {
  it("starts PostHog after mount and renders nothing", async () => {
    const { container } = render(<PostHogLazy />);
    expect(container.innerHTML).toBe("");
    await waitFor(() => expect(startPostHog).toHaveBeenCalledTimes(1));
  });
});
