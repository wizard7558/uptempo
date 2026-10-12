import { expect, test } from "@playwright/test";
import postgres from "postgres";

const SCHEMA = `"tenant_test-salon"`;
const CLIENT_ID = "f0e2e200-0000-4000-8000-000000000001";

test.setTimeout(120_000);

test("staff edit client fields, add one, and filter the list", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await page.goto("/clients");
    const row = page.getByRole("row").filter({
      has: page.getByRole("checkbox", { name: "Select E2E Test Client" }),
    });
    await row.getByRole("cell", { name: "E2E", exact: true }).click();
    // The row click is a client-side push, so the first compile of
    // /clients/[clientId] in next dev lands inside this wait.
    await expect(page).toHaveURL(new RegExp(`/clients/${CLIENT_ID}$`), { timeout: 15_000 });

    const card = page.getByRole("region", { name: "Client details" });
    await expect(card.getByText("Hair profile")).toBeVisible();
    await expect(card.getByText("Blonde, Curly")).toBeVisible();

    await card.getByRole("button", { name: "Edit" }).click();
    await expect(card.getByRole("button", { name: "Blonde" })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Red" }).click();
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
    const clientUrl = page.url();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Client details" }).getByText("Blonde, Red, Curly"),
    ).toBeVisible();

    await page.goto("/settings/custom-fields");
    const clientFields = page.getByRole("region", { name: "Client fields" });
    await clientFields.getByRole("button", { name: "Add a field" }).click();
    await page.getByLabel("Field name").fill("Allergies");
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "Short text" }).click();
    await page.getByRole("button", { name: "Save field" }).click();
    await expect(page.getByLabel("Field name")).toBeHidden();

    await page.goto(clientUrl);
    const updated = page.getByRole("region", { name: "Client details" });
    await expect(updated.getByText("Allergies")).toBeVisible();
    await expect(updated.getByText("Not set")).toBeVisible();

    await page.goto("/clients");
    await page.getByLabel("Filter by").click();
    await page.getByRole("option", { name: "Hair profile" }).click();
    await page.getByLabel("Value").click();
    await page.getByRole("option", { name: "Blonde" }).click();
    await expect(page.getByRole("checkbox", { name: "Select E2E Test Client" })).toBeVisible();
  } finally {
    await sql.unsafe(
      `UPDATE ${SCHEMA}.clients SET attributes = '{"hair_types":["blonde","curly"]}'::jsonb WHERE id = '${CLIENT_ID}'`,
    );
    await sql.unsafe(
      `DELETE FROM ${SCHEMA}.custom_field_definitions WHERE entity = 'client' AND label = 'Allergies'`,
    );
    await sql.end();
  }
});
