'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '../assets/icon.png'));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512,
    frame: false, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  await win.loadFile(path.join(__dirname, 'icon-page.html'));
  await new Promise(r => setTimeout(r, 600));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('PNG saved:', OUT);
  app.quit();
});
