// Start Launchpad against the REAL pedal (no simulation), wait, and report what it found + a screenshot.
// Reads only. npx electron scripts/probe.cjs [screenshot.png]
const { app, BrowserWindow } = require("electron");
const path = require("node:path"), fs = require("node:fs");
const shot = process.argv.find((a) => a.endsWith(".png"));
app.whenReady().then(async () => {
  require("../services.js").setup();
  const win = new BrowserWindow({ width: 1360, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, sandbox: true } });
  await win.loadFile(path.join(__dirname, "..", "src", "index.html"));
  await new Promise((r) => setTimeout(r, 9000));
  console.log(await win.webContents.executeJavaScript(`document.getElementById("conn").innerText + " | " + document.querySelector(".facts")?.innerText.replace(/\\n/g, " ")`));
  if (shot) fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
  app.quit();
});
