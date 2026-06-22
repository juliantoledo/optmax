import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = path.resolve(fileURLToPath(import.meta.url), '../..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ICON_APP = path.join(ROOT, 'scripts', 'icon-app.js');
const OUT_PNG  = path.join(ROOT, 'assets', 'icon.png');
const OUT_ICO  = path.join(ROOT, 'assets', 'icon.ico');

// Step 1: render icon via Electron
console.log('Rendering icon…');
execSync(`"${ELECTRON}" "${ICON_APP}" "${OUT_PNG}"`, { stdio: 'inherit' });
console.log('PNG ready.');

// Step 2: wrap PNG in ICO (PNG-in-ICO, Windows Vista+)
const png = fs.readFileSync(OUT_PNG);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = ICO
header.writeUInt16LE(1, 4); // image count = 1

const dir = Buffer.alloc(16);
dir.writeUInt8(0, 0);            // width  (0 = 256)
dir.writeUInt8(0, 1);            // height (0 = 256)
dir.writeUInt8(0, 2);            // palette entries
dir.writeUInt8(0, 3);            // reserved
dir.writeUInt16LE(1, 4);         // color planes
dir.writeUInt16LE(32, 6);        // bits per pixel
dir.writeUInt32LE(png.length, 8); // size of image data
dir.writeUInt32LE(22, 12);        // offset to image data (6 + 16)

fs.writeFileSync(OUT_ICO, Buffer.concat([header, dir, png]));
console.log('ICO saved:', OUT_ICO);
