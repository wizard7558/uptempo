import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Field } from "./field";

describe("Field", () => {
  it("connects label and input for accessibility", () => {
    const html = renderToStaticMarkup(
      <Field htmlFor="client-email" label="Email address" required>
        <Field.Input id="client-email" type="email" />
      </Field>,
    );

    expect(html).toContain("for=\"client-email\"");
    expect(html).toContain("id=\"client-email\"");
    expect(html).toContain("Email address");
  });

  it("renders description and error copy", () => {
    const html = renderToStaticMarkup(
      <Field
        htmlFor="client-name"
        label="Name"
        description="Used on appointment confirmations."
        error="Name is required."
      >
        <Field.Input id="client-name" />
      </Field>,
    );

    expect(html).toContain("Used on appointment confirmations.");
    expect(html).toContain("Name is required.");
  });
});
