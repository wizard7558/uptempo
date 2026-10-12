// @vitest-environment happy-dom
//
// happy-dom rather than jsdom: jsdom 27's CSS dependency chain does a
// `require()` of an ES module, which Node 20.18 (this repo's runtime) rejects.
// The other component tests sidestep the DOM entirely via renderToStaticMarkup,
// but this component is all interaction — the yes/no branching is the behavior
// worth testing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { joinWaitlistMock } = vi.hoisted(() => ({
  joinWaitlistMock: vi.fn(),
}));

// The action is a "use server" module — mock it so the test never touches the DB.
vi.mock("@/actions/waitlist", () => ({
  joinWaitlist: joinWaitlistMock,
}));

import { QuizWaitlistPrompt } from "./waitlist-prompt";

type PromptProps = React.ComponentProps<typeof QuizWaitlistPrompt>;

const QUIZ_CONTACT: PromptProps = {
  name: "Emma Lord",
  email: "emma@example.com",
  phone: "555-0142",
  source: "chair",
};

function renderPrompt(overrides: Partial<PromptProps> = {}) {
  return render(<QuizWaitlistPrompt {...QUIZ_CONTACT} {...overrides} />);
}

describe("QuizWaitlistPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinWaitlistMock.mockResolvedValue({ success: true, alreadyJoined: false });
  });

  afterEach(cleanup);

  it("is a one-tap yes when the quiz captured a usable email", async () => {
    const user = userEvent.setup();
    renderPrompt();

    // No email field — the whole point is that nothing gets re-typed.
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.getByText(/emma@example\.com/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /yes, add me/i }));

    await waitFor(() => expect(joinWaitlistMock).toHaveBeenCalledTimes(1));
    expect(joinWaitlistMock).toHaveBeenCalledWith({
      name: "Emma Lord",
      email: "emma@example.com",
      phone: "555-0142",
      source: "quiz-chair", // placement preserved, tagged as quiz-sourced
    });

    await screen.findByText(/you're on the waitlist/i);
  });

  it("falls back to asking for an email when the quiz didn't capture one", async () => {
    const user = userEvent.setup();
    renderPrompt({ email: "" });

    const input = screen.getByLabelText(/email/i);
    const join = screen.getByRole("button", { name: /join the waitlist/i });

    // Can't submit until the address is plausible.
    expect((join as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, "new@example.com");
    expect((join as HTMLButtonElement).disabled).toBe(false);

    await user.click(join);

    await waitFor(() => expect(joinWaitlistMock).toHaveBeenCalledTimes(1));
    expect(joinWaitlistMock.mock.calls[0][0].email).toBe("new@example.com");
  });

  it("treats a malformed quiz email as no email at all", () => {
    renderPrompt({ email: "not-an-email" });
    // Falls back to the input rather than offering a yes the server would reject.
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /yes, add me/i })).toBeNull();
  });

  it("hides itself when the respondent declines, without calling the action", async () => {
    const user = userEvent.setup();
    const { container } = renderPrompt();

    await user.click(screen.getByRole("button", { name: /no thanks/i }));

    expect(container.textContent).toBe("");
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it("reports a duplicate signup as success", async () => {
    joinWaitlistMock.mockResolvedValue({ success: true, alreadyJoined: true });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: /yes, add me/i }));

    await screen.findByText(/you're on the waitlist/i);
  });

  it("surfaces a retryable error when the action fails", async () => {
    joinWaitlistMock.mockResolvedValue({ success: false, error: "failed" });
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: /yes, add me/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);
    // Still offered, so the respondent can try again.
    expect(screen.getByRole("button", { name: /yes, add me/i })).toBeTruthy();
  });

  it("does not throw if the action rejects", async () => {
    joinWaitlistMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole("button", { name: /yes, add me/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);
  });

  it("uses a bare 'quiz' source when the quiz had no ?src=", async () => {
    const user = userEvent.setup();
    renderPrompt({ source: null });

    await user.click(screen.getByRole("button", { name: /yes, add me/i }));

    await waitFor(() => expect(joinWaitlistMock).toHaveBeenCalledTimes(1));
    expect(joinWaitlistMock.mock.calls[0][0].source).toBe("quiz");
  });
});
