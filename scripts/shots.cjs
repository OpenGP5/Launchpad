// Screenshots of Launchpad with the simulated pedal, every section in every theme, for design review.
//   npx electron scripts/shots.cjs [out dir]     (default: design/screens)
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith("-") && !a.endsWith("shots.cjs")) || path.join(__dirname, "..", "design", "screens"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  require("../services.js").setup();
  fs.mkdirSync(out, { recursive: true });
  const shots = [];
  const win = new BrowserWindow({ width: 1360, height: 860, show: false, backgroundColor: "#17161b",
    webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, sandbox: true } });
  const page = require("node:url").pathToFileURL(path.join(__dirname, "..", "src", "index.html")).href;
  for (const [sim, setup] of [["nam@0.4.0", "tones"], ["dreamcatcher", "dream"], ["stock", null]]) {
    await win.loadURL(page + "?" + sim.replace(/[@.]/g, "") + "#sim=" + sim);
    await sleep(1500);
    const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    if (setup === "tones") await js(`const { ctx } = window.__launchpad; const N = await import('./lib/gp5nam.js');
      const names = ['JCM800 2203', 'Dumble Clean', 'Orange Dual Terror', 'Boss Blues Driver BD-2', 'Fender Deluxe Reverb'];
      const f = new Uint8Array(4448); f.set([0x41,0x32,0x52,0x31]); new DataView(f.buffer).setUint32(4, 4448, true);
      for (let i = 0; i < names.length; i++) { const b = f.slice(); new DataView(b.buffer).setUint32(8, 1000 + i, true);
        b.set(new TextEncoder().encode(names[i]), 44); await ctx.withLink('x', (l) => N.writeKeep(l, i * 4608, b)); }
      window.__launchpad.state.sim.dspCrc = 1001; await ctx.reloadNam();`);
    if (setup === "dream") await js(`const { ctx } = window.__launchpad; const D = await import('./lib/device.js'); const S = await import('./lib/gp5store.js');
      const s = Array(8).fill(null); s[0] = [1,128,10,0,0,255,160,200,1,150,150,0,70,165,5,0,183,85,110,255];
      s[1] = [1,128,8,1,0,126,160,200,1,138,157,144,189,172,4,0,155,188,127,255]; s[2] = [1,200,6,0,1,90,40,220,2,60,230,30,20,240,6,1,40,200,180,200];
      s[5] = [1,90,9,0,0,200,128,180,0,220,90,200,40,90,0,0,128,128,60,230];
      await ctx.withLink('x', (l) => D.storeSave(l, S.IDS.dreamcatcher, S.encodeDreamcatcher({ last: 1, slots: s }))); await ctx.reloadDream();`);
    const views = sim.startsWith("nam") ? ["home", "tones", "flash", "backups"] : sim === "dreamcatcher" ? ["home", "presets"] : ["home", "mods", "settings"];
    for (const theme of ["dark", "light"]) {
      await js(`document.documentElement.dataset.theme = ${JSON.stringify(theme === "light" ? "studio" : "stage")};`);
      for (const v of views) {
        await js(`window.__launchpad.ctx.go(${JSON.stringify(v)});`);
        await sleep(450);
        const img = await win.webContents.capturePage();
        const file = path.join(out, `${sim.split("@")[0]}-${v}-${theme}.png`);
        fs.writeFileSync(file, img.toPNG()); shots.push(file);
      }
    }
  }
  win.destroy();
  console.log(shots.length + " screenshots in " + out);
  app.quit();
});
