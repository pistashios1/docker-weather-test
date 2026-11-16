import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT || "5055";
// CI runners need no flags; a root sandbox container sets E2E_NO_SANDBOX=1.
const args = process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : [];

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { args },
    channel: process.env.E2E_CHANNEL || undefined
  },
  webServer: {
    command: `python -m app.weather_app`,
    cwd: "../..",
    env: { PORT: port },
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
});
