/// <reference types="node" />
import { spawnSync } from 'child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { pickAlex, resetOnboarding, skipOnboarding } from '../e2e/app';
import { ClipRecorder } from './clips';
import {
  act,
  beat,
  CLIP_SIZE,
  correctOption,
  DUEL_AREAS,
  glide,
  ORDER,
  playDuel,
  playLesson,
  stubJev,
  tap,
  today,
  TOUCH_RINGS,
  waitForGlobe,
} from './journey';

/**
 * Demo recording "Berlin, from first lesson to first step". Not a test: run it with `make record`.
 *
 * One clip per slot of the pitch deck (presentation/clips/README.txt), in the order the deck plays them:
 *
 *  -  (off camera) Alex signs in.
 * 01-bank-nudge     The bank: Atlas's notification shows, runs out and drops into the Learn button.
 * 02-onboarding     Atlas's intro slides, the consent, what the money is for and when.
 * 03-quick-check    The Quick check.
 * 04-learning-path  "How we see you" with the start city's route, which must be Berlin (else 02 to 04 are filmed
 *                   again).
 * 05-map-to-berlin  The globe: the "Start here" story (Berlin), its path, "Start mission", the first scene as video
 *                   and the transcript instead of the second one.
 * 06-lesson-start   The basket slider, Myth or fact with a glossary word opened, the challenge question.
 * 07-lesson-yours   The checkpoints, his own accounts, his own basket.
 * 08-lesson-end     "Lesson complete" and the XP, back to the path, slowly down to the missions ahead.
 *  -  (off camera) The other four Berlin missions are finished, as if played in between.
 * 09-first-step     "Take the first step": the recap, the bank's products, the fixed-term deposit picked.
 * 10-deposit        The deposit lit in the bank, its terms, then the bank's main screen.
 * 11-duel           A duel on Berlin and Seoul against a rival, won with two mistakes.
 * 12-duel-review    The review: the Berlin mistake opens its mission (done), the Seoul one a mission still locked;
 *                   then the duel lobby and the weekly ranking.
 *
 * Output in recordings/out/berlin/ (the clips and all of them in one berlin-first-step.mp4). A take that passes also
 * copies the clips into presentation/clips/, where the deck plays them.
 */
const OUT_DIR = 'recordings/out/berlin';
/** `make record-duel` films only clips 11 and 12, apart from the whole take. */
const DUEL_OUT_DIR = 'recordings/out/duel';
/** Where the pitch deck (presentation/atlas-pitch.html) looks for its clips; relative to front/. */
const DECK_CLIPS_DIR = '../presentation/clips';
/** The glossary word opened in Myth or fact: it is underlined in the explanation once every card is sorted. */
const GLOSSARY_WORD = 'inflation';
/** The bank product picked at the end of Berlin: a fixed-term deposit, in Overview › Save. */
const OFFER = 'fixed-term';
/** How many times step 2 may be filmed until the summary starts in Berlin. */
const MAX_ONBOARDING_TAKES = 3;
/** The device id the recording signs in with (lib/session.ts keeps it in localStorage). */
const RECORDING_DEVICE_ID = 'demo-recording';
/** How long the result screen may take to show the level-up overlay (ResultView: the XP bars, then a gap). */
const LEVEL_UP_WAIT_MS = 10_000;

let clips: ClipRecorder | undefined;

/** Finishes Berlin's missions through the API, all answers right, as if played in between. */
async function finishBerlin(request: APIRequestContext, ids: string[]) {
  for (const id of ids) {
    const lesson = JSON.parse(readFileSync(path.resolve(`../back/src/main/resources/content/lessons/${id}.json`), 'utf8')) as {
      steps: { id: string; type: string }[];
    };
    const graded = lesson.steps.filter((s) => ['quiz', 'match', 'sort', 'predict', 'scenario', 'slider-chart'].includes(s.type));
    const res = await request.post(`/api/lessons/${id}/result?userId=demo-user`, {
      data: {
        steps: graded.map((s) => ({ stepId: s.id, correctFirstTry: true })),
        scenarioChoices: Object.fromEntries(graded.filter((s) => s.type === 'scenario').map((s) => [s.id, 0])),
        mode: 'video',
        completedOn: today(),
      },
    });
    expect(res.ok(), `${id}: ${await res.text()}`).toBe(true);
  }
}

/** Opens the app on the bank as Alex (the account picker opens on every start, a reload included). */
async function signIn(page: Page) {
  await page.goto('/');
  await pickAlex(page);
  await expect(page.getByTestId('screen-overview')).toBeVisible({ timeout: 120_000 });
}

/** Atlas's notification on the bank: it shows, its timer runs out and it drops into the Learn button. */
async function notificationDropsIntoLearn(page: Page) {
  const nudge = page.getByTestId('fq-teaser-home');
  await expect(nudge).toBeVisible({ timeout: 20_000 });
  await expect(nudge).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('nav-learn-dot')).toBeVisible();
}

/** Learn → onboarding → the Quick check → "How we see you", as clips 02 to 04. Returns whether it starts in Berlin. */
async function onboard(page: Page, rec: ClipRecorder): Promise<boolean> {
  await rec.start('02-onboarding');
  await tap(page, 'nav-learn', 800);
  await expect(page.getByTestId('onboarding-welcome')).toBeVisible();
  await beat(page, 2500);
  await tap(page, 'onboarding-start');
  await expect(page.getByTestId('onboarding-intro')).toBeVisible();
  await beat(page, 2500);
  await tap(page, 'onboarding-next');
  await expect(page.getByTestId('onboarding-challenge')).toBeVisible();
  await beat(page, 2500);
  await tap(page, 'onboarding-challenge-next');
  await expect(page.getByTestId('onboarding-consent')).toBeVisible();
  await beat(page, 3000);
  await tap(page, 'consent-accept');
  // What to learn first: the Berlin take starts from Saving.
  await tap(page, 'interest-saving', 1000);
  await tap(page, 'onboarding-continue');

  // The Quick check: after each answer the right one shows with the lesson's explanation.
  await expect(page.getByTestId('onboarding-check-intro')).toBeVisible({ timeout: 20_000 });
  await rec.start('03-quick-check');
  await beat(page, 2000);
  await tap(page, 'check-start');
  const answer = async (testId: string) => {
    await beat(page, 2500); // reading the question
    await tap(page, testId);
    await beat(page, 3000); // the right answer and why
    await tap(page, 'quick-check-continue', 300);
  };
  // Real return: Alex mixes it up. Emergency fund: right. A share that fell by half: not sure.
  await answer(`quick-check-option-${correctOption(ORDER[0]) + 1}`);
  await answer(`quick-check-option-${correctOption(ORDER[1])}`);
  await answer('quick-check-unsure');

  // "How we see you": the level, then slowly down to the first stop of the start city's route.
  await expect(page.getByTestId('learning-path')).toBeVisible({ timeout: 30_000 });
  // The route replaces the plain first-stop card once the stories have loaded; film it, not the card.
  const route = page.getByTestId('summary-route');
  await expect(route).toBeVisible({ timeout: 20_000 });
  await rec.start('04-learning-path');
  await beat(page, 3000);
  await glide(page, route.getByTestId('summary-first-lesson'));
  await beat(page, 3000);
  // The city is in the route's header, above its stops, as an uppercase overline (innerText reads it as BERLIN).
  return /berlin/i.test(await route.innerText());
}

/** Leaves exactly `areas` ticked in the duel lobby: the others off first, since at most 4 can be ticked. */
async function pickCategories(page: Page, areas: string[]) {
  const chips = page.locator('[data-testid^="duel-category-"][aria-checked]');
  await expect(chips.first()).toBeVisible({ timeout: 20_000 });
  const ids = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
  const ticked = async (id: string) => (await page.getByTestId(id).getAttribute('aria-checked')) === 'true';
  for (const id of ids) if (!areas.includes(id.replace('duel-category-', '')) && (await ticked(id))) await tap(page, id, 350);
  for (const id of ids) if (areas.includes(id.replace('duel-category-', '')) && !(await ticked(id))) await tap(page, id, 350);
}

/** Opens the "Wrong answers" group of the review, unless it is open already. */
async function openWrongAnswers(page: Page, index: number) {
  if (!(await page.getByTestId(`review-mistake-${index}`).isVisible())) await tap(page, 'toggle-wrong-review', 800);
  await expect(page.getByTestId(`review-mistake-${index}`)).toBeVisible();
}

/** Opens the review card of the mistake on question `index` (0-based) and follows its lesson link. */
async function openMistake(page: Page, index: number) {
  await tap(page, `review-mistake-${index}`, 800);
  await beat(page, 3500); // the explanation and where the lesson is
  await tap(page, `review-repeat-lesson-${index}`, 800);
}

/**
 * Clips 11 and 12, from the bank's main screen: back to Atlas, a duel on Saving and Risk against a rival with two
 * mistakes on purpose (see playDuel), the review of both mistakes, the duel lobby and the weekly ranking.
 */
async function filmDuel(page: Page, rec: ClipRecorder) {
  // 11. Back to Atlas, a duel on Saving and Risk against a rival, two mistakes on purpose (see playDuel).
  await rec.start('11-duel');
  await tap(page, 'nav-learn', 800);
  await waitForGlobe(page);
  await beat(page, 1500);
  await tap(page, 'nav-duel', 800);
  await expect(page.getByTestId('screen-duel')).toBeVisible();
  await pickCategories(page, DUEL_AREAS);
  await tap(page, 'duel-mode-human', 700);
  await tap(page, 'duel-start-cta', 1000);
  const mistakes = await playDuel(page);
  await expect(page.getByTestId('duel-result')).toBeVisible({ timeout: 120_000 });
  await beat(page, 4000); // the win, the score and XP
  // A category that levelled up gets an overlay once the XP bars have filled (a few seconds after the result shows).
  // Each tap moves on to the next category or closes it.
  const levelUp = page.getByTestId('level-up-overlay');
  await levelUp.waitFor({ state: 'visible', timeout: LEVEL_UP_WAIT_MS }).catch(() => {});
  while (await levelUp.isVisible()) {
    await beat(page, 3000);
    await act(page);
    await levelUp.click();
    await page.waitForTimeout(800); // the next category, or the overlay fading out
  }
  await beat(page, 1500);

  // 12. The review: slowly down to the mistakes, then each one's mission: Berlin's is done, Seoul's still locked.
  // Then back to the duel lobby and the weekly ranking.
  await rec.start('12-duel-review');
  await glide(page, page.getByTestId('review-title'));
  await beat(page, 1500);
  await openWrongAnswers(page, mistakes.open);
  await beat(page, 1500);
  await openMistake(page, mistakes.open);
  // The path loads before its stops show; the pause starts once they are there.
  await expect(page.locator('[data-testid^="lesson-berlin-"]').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  await beat(page, 4000); // the lesson, highlighted on Berlin's line
  await page.goBack();
  await expect(page.getByTestId('duel-result')).toBeVisible();
  await beat(page, 1500);
  await openWrongAnswers(page, mistakes.locked);
  await openMistake(page, mistakes.locked);
  await expect(page.getByTestId('story-locked-sheet')).toBeVisible({ timeout: 20_000 });
  await beat(page, 4500); // "lesson locked" and which lesson opens it
  await tap(page, 'story-locked-close', 600);
  await beat(page, 1500);
  await page.goBack();
  await expect(page.getByTestId('duel-result')).toBeVisible();
  await beat(page, 1000);
  await tap(page, 'result-back-lobby', 800);
  await expect(page.getByTestId('screen-duel')).toBeVisible();
  await beat(page, 1500);
  await tap(page, 'duel-open-rankings', 800);
  await expect(page.getByTestId('screen-duel-rankings')).toBeVisible();
  await beat(page, 2000);
  await glide(page, page.getByTestId('rankings-scroll'), 'end');
  await beat(page, 3000);
  await rec.stop();
}

test.beforeAll(async ({ request }) => {
  await resetOnboarding(request);
  // A fresh start: no lessons done, so Berlin's offers appear only after the story is finished.
  const reset = await request.post(`/api/users/demo-user/progress/reset?today=${today()}`);
  expect(reset.ok()).toBe(true);
  // Lessons open in video mode; a mode switched in an earlier take is remembered.
  const mode = await request.put('/api/users/demo-user/lesson-mode', { data: { mode: 'video' } });
  expect(mode.ok()).toBe(true);
});

/** The page as every take films it: touch rings, the stubbed Jev, and always the same device. */
async function preparePage(page: Page) {
  await page.addInitScript(TOUCH_RINGS);
  // Every take signs in from the same device, so Alex's lock left by an earlier take (it lives 2 minutes) is its own.
  await page.addInitScript((id) => window.localStorage.setItem('fq_device_id', id), RECORDING_DEVICE_ID);
  await stubJev(page);
}

test('Berlin: from the bank notification to the first step, a duel and the ranking', { tag: '@take' }, async ({ page, request }) => {
  test.setTimeout(25 * 60_000);
  const rec = (clips = new ClipRecorder(page, OUT_DIR, CLIP_SIZE));
  await preparePage(page);

  // 0. Off camera: sign in as Alex.
  await signIn(page);
  // The bank renders at 412 CSS px; a wider value means the 3× rendering broke the mobile layout.
  expect(await page.evaluate(() => window.innerWidth)).toBe(412);

  // 01. The bank and Atlas's notification, until it drops into the Learn button.
  await rec.start('01-bank-nudge');
  await notificationDropsIntoLearn(page);
  await beat(page, 1500);

  // 02–04. Onboarding up to the summary; filmed again until the summary starts in Berlin.
  for (let take = 1; ; take++) {
    if (await onboard(page, rec)) break;
    expect(take, 'the summary never started in Berlin').toBeLessThan(MAX_ONBOARDING_TAKES);
    await rec.discard();
    await resetOnboarding(request);
    await signIn(page);
    await notificationDropsIntoLearn(page);
  }
  await tap(page, 'summary-start');
  await rec.stop();

  // 05. The globe, filmed once it is drawn (the first WebGL frame takes a few seconds): the "Start here" story,
  // which must be Berlin, its path, the first lesson's "Start mission", the video, then the transcript.
  await waitForGlobe(page);
  await rec.start('05-map-to-berlin');
  await beat(page, 2500);
  await expect(page.getByTestId('story-card-berlin').getByTestId('story-card-start-here')).toBeVisible();
  await tap(page, 'story-card-berlin', 800);
  await expect(page.getByTestId('callout-start-here')).toBeVisible();
  await beat(page, 2500); // the globe flies to Berlin
  await tap(page, 'pin-callout-open', 1200);
  await expect(page.getByTestId('screen-story')).toBeVisible();
  const startMission = page.getByTestId('lesson-berlin-1');
  await expect(startMission).toHaveText(/Start mission/);
  await glide(page, startMission);
  await beat(page, 2000);
  await tap(page, 'lesson-berlin-1', 600);

  // 06 and 07 start inside the lesson: at the basket slider and at the first checkpoint.
  const glossaryOpened = await playLesson(page, {
    glossary: GLOSSARY_WORD,
    onPractice: () => rec.start('06-lesson-start'),
    onCheckpoints: () => rec.start('07-lesson-yours'),
  });
  expect(glossaryOpened, `the glossary word ${GLOSSARY_WORD} was not opened`).toBe(true);

  // 08. "Lesson complete" and the XP, back to the path, slowly down to the missions still ahead.
  await expect(page.getByTestId('lesson-end')).toBeVisible();
  await rec.start('08-lesson-end');
  await expect(page.getByTestId('lesson-xp')).toBeVisible();
  await beat(page, 4500); // "Lesson complete", the XP and the concepts learned
  await tap(page, 'back-to-list', 800);
  const story = page.getByTestId('screen-story').filter({ visible: true }).last();
  await expect(story).toBeVisible();
  await glide(page, story, 'end');
  await beat(page, 2500);
  await rec.stop();

  // Off camera: the other four Berlin missions, then Berlin's path again with every stop done. The reload opens
  // the bank first, so its notification is out of the way and the globe is drawn before 11 comes back to it.
  await finishBerlin(request, ['berlin-2', 'berlin-3', 'berlin-4', 'berlin-5']);
  await signIn(page);
  await notificationDropsIntoLearn(page).catch(() => {}); // after Berlin there may be no notification
  await page.getByTestId('nav-learn').click();
  await waitForGlobe(page);
  await page.getByTestId('story-card-berlin').click();
  await page.getByTestId('pin-callout-open').click();
  await expect(page.getByTestId('offers-entry-open')).toBeVisible({ timeout: 60_000 });
  await story.evaluate((el) => el.scrollTo({ top: 0 }));

  // 09. The end of the line: what Berlin taught, the bank's products, the fixed-term deposit picked.
  await rec.start('09-first-step');
  await beat(page, 2000); // five stamps on Berlin's line
  await tap(page, 'offers-entry-open', 800);
  await expect(page.getByTestId('path-recap')).toBeVisible();
  await beat(page, 6000); // what the story taught, and "Your move"
  await tap(page, 'offers-continue', 800);
  await expect(page.getByTestId(`offer-${OFFER}`)).toBeVisible();
  await beat(page, 4000); // the products, each with the lesson it connects to
  await tap(page, `offer-${OFFER}`, 1000);
  await expect(page.getByTestId('spotlight-note')).toBeVisible({ timeout: 20_000 });

  // 10. The deposit in the bank: lit, its terms, then the bank's main screen.
  await rec.start('10-deposit');
  await beat(page, 4500); // the product's button lit in the bank, the rest dimmed
  await tap(page, 'spotlight-ok', 600);
  await expect(page.getByTestId('spotlight-note')).toBeHidden();
  await tap(page, `product-${OFFER}`, 800);
  await expect(page.getByTestId('product-start')).toBeVisible();
  await beat(page, 5000); // the terms
  await tap(page, 'sheet-close', 600);
  await expect(page.getByTestId('detail-sheet')).toBeHidden();
  await expect(page.getByTestId('screen-overview')).toBeVisible();
  await beat(page, 2500);

  await filmDuel(page, rec);
  await rec.stop();
});

/**
 * Clips 11 and 12 alone (`make record-duel`): Alex is set up off camera as after the whole take up to 10 (onboarding
 * done, all of Berlin finished), then the duel is filmed from the bank's main screen.
 */
test('Duel: a match, its review and the ranking', { tag: '@duel' }, async ({ page, request }) => {
  test.setTimeout(10 * 60_000);
  const rec = (clips = new ClipRecorder(page, DUEL_OUT_DIR, CLIP_SIZE));
  await preparePage(page);
  await skipOnboarding(request);
  await finishBerlin(request, ['berlin-1', 'berlin-2', 'berlin-3', 'berlin-4', 'berlin-5']);
  await signIn(page);
  await notificationDropsIntoLearn(page).catch(() => {}); // there may be no notification once Berlin is done
  // The globe draws its first frame off camera, so clip 11 does not open on an empty globe.
  await page.getByTestId('nav-learn').click();
  await waitForGlobe(page);
  await page.getByTestId('nav-bank').click();
  await expect(page.getByTestId('screen-overview')).toBeVisible();
  await filmDuel(page, rec);
});

/**
 * Frees Alex for other devices, encodes the clips (also after a failed step, to show where it stopped) and joins them
 * into one film. Only a take that passed replaces the deck's clips.
 */
test.afterEach(async ({ page, request }, testInfo) => {
  await clips?.stop();
  // Closed before the lock is freed: an open page keeps renewing it with its heartbeat.
  await page.close();
  await request.delete(`/api/users/demo-user/session?deviceId=${RECORDING_DEVICE_ID}`).catch(() => {});
  if (!clips) return;
  test.setTimeout(40 * 60_000);
  const files = await clips.encode();
  console.log(`\nClips:\n${files.map((f) => `  front/${f}`).join('\n')}\n`);
  if (testInfo.tags.includes('@take')) {
    const film = joinClips(files);
    if (film) console.log(`Whole take: front/${film}\n`);
  }
  if (testInfo.status === testInfo.expectedStatus) {
    for (const file of files) copyFileSync(file, path.join(DECK_CLIPS_DIR, path.basename(file)));
    console.log(`Copied to presentation/clips/: ${files.map((f) => path.basename(f)).join(', ')}\n`);
  }
});

test.afterAll(async ({ request }) => {
  await resetOnboarding(request);
});

/** Joins same-format clips without re-encoding (ffmpeg concat). Returns the file, or null when it could not. */
function joinClips(files: string[]): string | null {
  if (files.length < 2) return null;
  const ext = path.extname(files[0]);
  const list = path.join(OUT_DIR, 'clips.txt');
  writeFileSync(list, files.map((f) => `file '${path.resolve(f)}'`).join('\n'));
  const out = path.join(OUT_DIR, `berlin-first-step${ext}`);
  const run = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], {
    stdio: 'inherit',
  });
  return run.status === 0 ? out : null;
}
