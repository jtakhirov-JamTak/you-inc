import { test, expect } from "@playwright/test";
import {
  createAdminClient,
  newTestEmail,
  newTestPassword,
  createConfirmedUser,
  deleteUserById,
} from "./helpers/auth";

test("login → home loads", async ({ page }) => {
  const admin = createAdminClient();
  const email = newTestEmail();
  const password = newTestPassword();
  let userId: string | null = null;

  try {
    userId = await createConfirmedUser(admin, email, password);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await page.waitForURL("**/home", { timeout: 15_000 });
    await expect(page.getByText("Operating health")).toBeVisible();
  } finally {
    if (userId) await deleteUserById(admin, userId);
  }
});
