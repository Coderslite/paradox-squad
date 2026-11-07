import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--use-gl=angle", "--ignore-gpu-blocklist"] },
  },
  webServer: [
    { command: "pnpm --filter @paradox/server dev", port: 2567, reuseExistingServer: true, timeout: 60_000 },
    { command: "pnpm --filter @paradox/web dev", port: 3000, reuseExistingServer: true, timeout: 120_000 },
  ],
});
