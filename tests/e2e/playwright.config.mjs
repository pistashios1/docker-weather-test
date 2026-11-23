import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// Use the project's virtualenv when there is one, so the run does not depend on
// `python` being on PATH (it often is not on Windows). CI has no .venv and uses
// the `python` that setup-python puts on PATH.
const venvPython = fileURLToPath(new URL(
  process.platform === "win32" ? "../../.venv/Scripts/python.exe" : "../../.venv/bin/python",
  import.meta.url,
));
const python = existsSync(venvPython) ? `"${venvPython}"` : "python";

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
    channel: process.env.E2E_CHANNEL || undefined,
  },
  webServer: {
    command: `${python} -m app.weather_app`,
    cwd: "../..",
    env: { PORT: port },
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
});
