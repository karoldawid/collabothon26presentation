import { defineConfig } from '@playwright/test';

import base, { BACKEND_SERVER, WEB_SERVER } from './playwright.config';

/**
 * Demo recordings for the pitch (`make record`): the e2e setup (Pixel 7, the same web server, the dev backend below), filmed by
 * recordings/clips.ts as one clip per step.
 *
 * Chromium's screencast sends frames in CSS pixels whatever `deviceScaleFactor` says; only
 * --force-device-scale-factor makes it send the 3× pixels, so the 412 px wide phone becomes a 1236 px wide clip.
 */
const SCALE = 3;

/**
 * The backend as `make dev` runs it (the dev database, with the weekly ranking's demo players), but with a 5 s rival
 * search so the duel clip does not wait 15 s for the simulated rival. A backend that is already running is reused
 * as it is.
 */
const BACKEND = {
  ...BACKEND_SERVER,
  command: './mvnw spring-boot:run -Dspring-boot.run.arguments=--app.duel.queue-timeout-ms=5000',
};

export default defineConfig({
  ...base,
  webServer: [BACKEND, WEB_SERVER],
  testDir: 'recordings',
  testMatch: '*.rec.ts',
  retries: 0,
  reporter: 'list',
  use: {
    ...base.use,
    deviceScaleFactor: SCALE,
    launchOptions: { args: [`--force-device-scale-factor=${SCALE}`] },
    // A tap on a covered button fails after 20 s instead of retrying until the test timeout.
    actionTimeout: 20_000,
    video: 'off',
    trace: 'off',
    screenshot: 'off',
  },
});
