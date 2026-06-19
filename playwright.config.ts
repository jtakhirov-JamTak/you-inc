import { defineConfig, devices } from "@playwright/test";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Reuse locally for fast reruns (caveat: a stale dev server with HMR
    // failures can produce false greens — stop the dev server if in doubt).
    // CI has no existing server, so it always starts fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
