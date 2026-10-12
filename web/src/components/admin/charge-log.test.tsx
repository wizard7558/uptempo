import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/actions/charges", () => ({ waiveCharge: vi.fn(), refundCharge: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ChargeLog } from "./charge-log";

describe("ChargeLog", () => {
  it("renders a pack sale with no appointment as 'Pack sale' without a link", () => {
    const html = renderToStaticMarkup(
      <ChargeLog
        charges={[
          {
            id: "c1",
            clientName: "Pat Client",
            appointmentId: null,
            amountCents: 45000,
            reason: "package_sale",
            status: "completed",
            failureReason: null,
            createdAt: new Date("2031-03-04T15:00:00Z"),
          },
        ]}
      />,
    );
    expect(html).toContain("Pack sale");
    expect(html).not.toContain("package_sale");
    expect(html).toContain("Pat Client");
    expect(html).toContain("$450.00");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("/appointments/");
  });
});
