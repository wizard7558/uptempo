import { expect, type Page } from "@playwright/test";

/**
 * Pass location when it is still a picker on the time step.
 *
 * A single location is selected above the calendar and never asks for Continue.
 * Wait for the time heading, or the picker, and click Continue only while the
 * time heading is still hidden.
 */
export async function passLocationStep(page: Page): Promise<void> {
  const timeHeading = page.getByText("Select date & time");
  const locationHeading = page.getByText("Choose your location");
  await expect(timeHeading.or(locationHeading)).toBeVisible({ timeout: 15000 });
  if (await timeHeading.isVisible()) return;

  // The picker may still be loading (skeleton) and then auto-advance.
  const continueBtn = page.getByRole("button", { name: "Continue" });
  await expect(timeHeading.or(continueBtn)).toBeVisible({ timeout: 15000 });
  if (!(await timeHeading.isVisible())) {
    await continueBtn.click();
  }
}
