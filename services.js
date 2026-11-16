// Launchpad's main-process services: MIDI permission for the app's own page, native open / save dialogs, and
// the files that ship with the app. Used by main.js and by scripts/shots.cjs.
const { app, ipcMain, dialog, session, net, shell, powerSaveBlocker, clipboard, BrowserWindow } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

// small preferences the window needs before the page runs (size, position, theme): <userData>/window.json
const prefsFile = () => path.join(app.getPath("userData"), "window.json");
exports.readPrefs = () => { try { return JSON.parse(fsSync.readFileSync(prefsFile(), "utf8")); } catch { return {}; } };
exports.writePrefs = (p) => { try { fsSync.writeFileSync(prefsFile(), JSON.stringify({ ...exports.readPrefs(), ...p })); } catch { /* not important */ } };

exports.setup = function setup() {
  // the page writes to the pedal: keep the computer awake until it's done
  let blocker = null;
  ipcMain.on("busy", (_e, busy) => {
    if (busy && blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension");
    else if (!busy && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  });
  ipcMain.on("theme", (_e, t) => { if (t === "light" || t === "dark" || t === "system") exports.writePrefs({ theme: t }); });
  // Windows / Linux: Launchpad's own window buttons (no system title bar)
  ipcMain.on("window", (e, act) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (act === "minimize") w.minimize();
    else if (act === "maximize") { if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
    else if (act === "close") w.close();
  });
  ipcMain.handle("copy-text", (_e, text) => { if (typeof text === "string" && text.length < 100000) clipboard.writeText(text); return true; });
  // The pedal speaks SysEx over USB-MIDI: allow MIDI for the app's own page only (file://), nothing else.
  const ours = (wc) => wc && wc.getURL().startsWith("file://");
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb((perm === "midi" || perm === "midiSysex") && ours(wc)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => (perm === "midi" || perm === "midiSysex") && ours(wc));

  ipcMain.handle("open-file", async (_e, { title, filters }) => {
    const r = await dialog.showOpenDialog({ title, filters, properties: ["openFile"] });
    if (r.canceled || !r.filePaths.length) return null;
    const p = r.filePaths[0];
    return { name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)) };
  });
  ipcMain.handle("save-file", async (_e, { title, defaultName, filters, bytes }) => {
    const r = await dialog.showSaveDialog({ title, defaultPath: defaultName, filters });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, Buffer.from(bytes));
    return { name: path.basename(r.filePath), path: r.filePath };
  });
  // files that ship with the app (src/firmware/...): only below src/, nothing else
  ipcMain.handle("app-file", async (_e, rel) => {
    const base = path.join(__dirname, "src"), p = path.resolve(base, rel);
    if (!p.startsWith(base + path.sep)) throw new Error("not an app file");
    return new Uint8Array(await fs.readFile(p));
  });
  // Updates: ask GitHub for Launchpad's newest release (no account, nothing about the user is sent) and report it
  // with the download that fits this computer. Installing is the user's click: unsigned apps can't update
  // themselves on macOS. Repository and tag prefix: package.json "launchpad.updates".
  ipcMain.handle("check-update", () => exports.checkUpdate());
  // open a link in the user's browser: only https links to GitHub (release pages and downloads)
  ipcMain.handle("open-link", (_e, url) => {
    if (typeof url === "string" && /^https:\/\/(github\.com|objects\.githubusercontent\.com|opengp5\.github\.io)\//.test(url)) shell.openExternal(url);
  });
  // read back a backup Launchpad saved earlier (the list on the Backups page): only .gp5backup files
  ipcMain.handle("read-backup", async (_e, p) => {
    if (typeof p !== "string" || !path.isAbsolute(p) || !p.toLowerCase().endsWith(".gp5backup")) throw new Error("not a backup file");
    return { name: path.basename(p), bytes: new Uint8Array(await fs.readFile(p)) };
  });
  // Valeton's stock firmware: from this computer's copy, or downloaded from Valeton's site when `download`
  // (only Valeton's known file is accepted, valeton.cjs). Kept in the app's own data folder.
  ipcMain.handle("valeton-firmware", async (_e, { version, download }) => {
    const { stockFirmware } = require("./valeton.cjs");
    return stockFirmware({ version, download: !!download, cacheDir: path.join(app.getPath("userData"), "valeton"), fetchFn: (u, o) => net.fetch(u, o) });
  });
  ipcMain.handle("app-info", () => ({ version: require("./package.json").version, platform: process.platform }));
};

exports.checkUpdate = async function checkUpdate(override) {
    const pkg = require("./package.json"), cfg = override || pkg.launchpad?.updates || {};
    if (!cfg.repo) return { error: "no update source configured" };
    let list;
    try {
      const r = await net.fetch(`https://api.github.com/repos/${cfg.repo}/releases?per_page=20`,
        { headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenGP5-Launchpad" } });
      if (!r.ok) return { error: `GitHub answered ${r.status}` };
      list = await r.json();
    } catch (e) { return { error: "offline" }; }
    const prefix = cfg.tagPrefix ?? "v";
    const ver = (t) => (t || "").startsWith(prefix) && /^\d+\.\d+\.\d+/.test(t.slice(prefix.length)) ? t.slice(prefix.length).match(/^(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number) : null;
    const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const mine = pkg.version.split(".").map(Number);
    const best = list.filter((x) => !x.draft && ver(x.tag_name)).sort((a, b) => newer(ver(b.tag_name), ver(a.tag_name)))[0];
    if (!best || newer(ver(best.tag_name), mine) <= 0) return { current: pkg.version, latest: best ? best.tag_name.slice(prefix.length) : pkg.version, update: false };
    const want = { darwin: process.arch === "arm64" ? /arm64.*\.dmg$/i : /^(?!.*arm64).*\.dmg$/i, win32: /\.exe$/i, linux: /\.AppImage$/i }[process.platform];
    const asset = want && (best.assets || []).find((a) => want.test(a.name));
    return { current: pkg.version, latest: best.tag_name.slice(prefix.length), update: true, notes: (best.body || "").slice(0, 4000),
             page: best.html_url, download: asset ? asset.browser_download_url : best.html_url, prerelease: !!best.prerelease };
};
