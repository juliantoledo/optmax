import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(APP_DIR, 'scripts', 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR], timeout: 30_000 });
const page = await app.firstWindow();
page.on('console', msg => { if (msg.type() === 'error') console.log('[err]', msg.text()); });

await page.waitForSelector('.sidebar', { timeout: 10_000 });
await new Promise(r => setTimeout(r, 1500));

const status = await page.evaluate(() => document.getElementById('status-text')?.textContent);
const nextRefresh = await page.evaluate(() => document.getElementById('next-refresh-date')?.textContent);
const interval = await page.evaluate(() => document.getElementById('interval-select')?.value);
console.log('Status:', status);
console.log('Next refresh:', nextRefresh);
console.log('Interval setting:', interval, 'days');

await page.screenshot({ path: path.join(SHOT_DIR, 'schedule-ui.png') });
console.log('Screenshot saved.');
await app.close();
