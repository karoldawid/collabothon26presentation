import { defineConfig, devices } from '@playwright/test';

/** Port of the Expo web server. Override (E2E_PORT=8082) to test without touching a running `make dev`. */
const WEB_PORT = Number(process.env.E2E_PORT ?? 8081);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8080);
const BACKEND_URL = process.env.BACKEND_URL ?? `http://localhost:${BACKEND_PORT}`;

/** The backend for the specs; `make record` runs its own variant (playwright.record.config.ts). */
export const BACKEND_SERVER = {
  command: './mvnw spring-boot:test-run',
  cwd: '../back',
  url: `${BACKEND_URL}/actuator/health`,
  timeout: 300_000,
  reuseExistingServer: !process.env.CI,
};

export const WEB_SERVER = {
  command: `npx expo start --web --localhost --port ${WEB_PORT}`,
  url: WEB_URL,
  timeout: 120_000,
  reuseExistingServer: !process.env.CI,
};

/**
 * End-to-end tests: the web build of the app in Chromium against the real backend.
 * Locally a running backend and Expo web server (e.g. from `make dev`) are reused; otherwise the
 * backend starts on a throwaway Testcontainers Postgres (Docker must be running). CI always starts both.
 */
export default defineConfig({
  testDir: 'e2e',
  // Every test drives the same signed-in user (demo-user), so they must not run side by side.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: WEB_URL,
    // The first page load waits for Metro to bundle the app.
    navigationTimeout: 120_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Metro bundles on the first request and proxies /api/* to the backend (metro.config.js).
  webServer: [BACKEND_SERVER, WEB_SERVER],
});
