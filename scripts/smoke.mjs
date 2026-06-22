// One-shot smoke test: launch → wait for load → screenshot → check UI state → quit
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = path.resolve(fileURLToPath(import.meta.url), '../..');
const SHOT_DIR = path.join(ROOT, 'scripts', 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

fs.mkdirSync(SHOT_DIR, { recursive: true });

console.log('Launching OptMax…');
const app = await electron.launch({
  executablePath: ELECTRON,
  args: [ROOT],
  timeout: 30_000,
});

const page = app.windows().find(w => !w.url().startsWith('devtools://'))
          ?? await app.firstWindow();

await page.waitForLoadState('domcontentloaded');
console.log('Window loaded:', page.url());

// Wait for the app's boot sequence (initSettingsUI + initWatchlists + loadInitialData)
await page.waitForSelector('#status-text', { timeout: 10_000 });
await new Promise(r => setTimeout(r, 3_000)); // let async boot settle

// ── Screenshot 1: Dashboard ───────────────────────────────────────────────────
const shot1 = path.join(SHOT_DIR, '01-dashboard.png');
await page.screenshot({ path: shot1 });
console.log('Screenshot:', shot1);

// ── Read UI state ─────────────────────────────────────────────────────────────
const state = await page.evaluate(() => ({
  statusText:  document.getElementById('status-text')?.textContent,
  activeView:  document.querySelector('.view.active')?.id,
  navLinks:    [...document.querySelectorAll('.nav-link')].map(l => l.textContent.trim()),
  strategyViews: ['view-strategy-ivr', 'view-strategy-iv-hv', 'view-strategy-mr']
    .map(id => ({ id, exists: !!document.getElementById(id) })),
  chipsIvr:    document.getElementById('chips-ivr')?.textContent?.trim(),
  helpBtn:     !!document.getElementById('help-btn'),
}));

console.log('\nUI state:');
console.log(JSON.stringify(state, null, 2));

// ── Navigate to IV Rank strategy view ────────────────────────────────────────
await page.evaluate(() => {
  document.querySelector('[data-view="strategy-ivr"]')?.click();
});
await new Promise(r => setTimeout(r, 500));

const shot2 = path.join(SHOT_DIR, '02-strategy-ivr.png');
await page.screenshot({ path: shot2 });
console.log('\nScreenshot:', shot2);

// ── Open help modal ───────────────────────────────────────────────────────────
await page.evaluate(() => document.getElementById('help-btn')?.click());
await new Promise(r => setTimeout(r, 400));

const shot3 = path.join(SHOT_DIR, '03-help-modal.png');
await page.screenshot({ path: shot3 });
console.log('Screenshot:', shot3);

// ── Navigate to IV vs HV ─────────────────────────────────────────────────────
await page.evaluate(() => {
  document.getElementById('help-close')?.click();
  setTimeout(() => document.querySelector('[data-view="strategy-iv-hv"]')?.click(), 200);
});
await new Promise(r => setTimeout(r, 800));

const shot4 = path.join(SHOT_DIR, '04-strategy-iv-hv.png');
await page.screenshot({ path: shot4 });
console.log('Screenshot:', shot4);

await app.close();
console.log('\nDone. Check scripts/shots/ for screenshots.');
