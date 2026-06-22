import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SHOT_DIR = path.join(ROOT, 'scripts', 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT], timeout: 30000 });
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => document.querySelector('[data-view="discover"]').click());
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: `${SHOT_DIR}/06-discover.png` });
console.log('screenshot saved');
await app.close();
