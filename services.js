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
  // (the asking page's address from the request itself: early in a page's life its webContents may not report one yet)
  const ours = (wc, url) => String(url || wc?.getURL() || "").startsWith("file://");
  const midi = (perm) => perm === "midi" || perm === "midiSysex";
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(midi(perm) && ours(wc, details?.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => midi(perm) && ours(wc, origin));
  // When the system's MIDI service failed to start, Chromium keeps that answer until the app restarts
  ipcMain.on("relaunch", () => { app.relaunch(); app.exit(0); });

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
  // The firmware catalog (OpenGP5's catalog/README.md): the list from OpenGP5's site, kept for when offline, and
  // downloads of the releases it lists, nothing else. Each download is checked against the list (size, checksum)
  // here, before the page sees it; the page then checks what the image says it is.
  ipcMain.handle("catalog", () => exports.catalog());
  ipcMain.handle("catalog-download", (_e, { url, sha256 }) => exports.catalogDownload(url, sha256));
};

// development only (an app that isn't packaged): LAUNCHPAD_CATALOG=<url> reads another catalog, e.g. a local test one,
// whose releases may then also be on http://localhost
const devCatalog = () => (!app.isPackaged && process.env.LAUNCHPAD_CATALOG) || null;
const CATALOG_URL = "https://opengp5.github.io/OpenGP5/catalog.json";
const releaseUrlOk = (u) => /^https:\/\//.test(u) || (!!devCatalog() && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
let catalogReleases = new Map();                    // "url sha256" -> { sha256, size } from the list read last
const catalogFile = () => path.join(app.getPath("userData"), "catalog.json");
function rememberReleases(index) {
  catalogReleases = new Map();
  for (const e of (index && index.firmwares) || []) for (const r of e.releases || [])
    if (r && typeof r.url === "string" && releaseUrlOk(r.url) && /^[0-9a-f]{64}$/.test(r.sha256) && Number.isInteger(r.size)) catalogReleases.set(`${r.url} ${r.sha256}`, r);
}
exports.catalog = async function catalog() {
  try {
    const r = await net.fetch(devCatalog() || CATALOG_URL, { headers: { "User-Agent": "OpenGP5-Launchpad" }, cache: "no-cache" });
    if (r.status === 404) throw new Error("OpenGP5's site has no catalog yet");
    if (!r.ok) throw new Error(`OpenGP5's site answered ${r.status}`);
    const text = await r.text(), index = JSON.parse(text);
    if (!index || index.version !== 1 || !Array.isArray(index.firmwares)) throw new Error("not a catalog");
    await fs.writeFile(catalogFile(), text).catch(() => {});
    rememberReleases(index);
    return { index, fresh: true };
  } catch (e) {
    const why = /^net::|fetch failed|ENOTFOUND|ECONN/.test(e.message) ? "can't reach OpenGP5's site: offline?" : e.message;
    try { const index = JSON.parse(await fs.readFile(catalogFile(), "utf8")); rememberReleases(index); return { index, fresh: false, error: why }; }
    catch { return { index: null, fresh: false, error: why }; }
  }
};
exports.catalogDownload = async function catalogDownload(url, sha256) {
  const want = catalogReleases.get(`${url} ${sha256}`);   // (two listings may share a file: the checksum says which)
  if (!want) throw new Error("not a release the catalog lists");
  const cache = path.join(app.getPath("userData"), "catalog-files", `${want.sha256}.bin`);
  const ok = (b) => b.length === want.size && require("node:crypto").createHash("sha256").update(b).digest("hex") === want.sha256;
  try { const b = await fs.readFile(cache); if (ok(b)) return new Uint8Array(b); } catch { /* not downloaded yet */ }
  const r = await net.fetch(url, { headers: { "User-Agent": "OpenGP5-Launchpad" } });
  if (!r.ok) throw new Error(`the download failed (${r.status})`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 4 * 1024 * 1024) throw new Error("the download is far too big for a GP-5 image");
  if (!ok(b)) throw new Error("the download doesn't match the catalog (size or checksum): not flashed");
  await fs.mkdir(path.dirname(cache), { recursive: true }).catch(() => {});
  await fs.writeFile(cache, b).catch(() => {});
  return new Uint8Array(b);
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
    const want = { darwin: process.arch === "arm64" ? /arm64.*\.dmg$/i : /^(?!.*arm64).*\.dmg$/i, win32: /\.exe$/i, linux: process.arch === "arm64" ? /arm64\.AppImage$/i : /(x86_64|x64|amd64)\.AppImage$/i }[process.platform];
    const asset = want && (best.assets || []).find((a) => want.test(a.name));
    return { current: pkg.version, latest: best.tag_name.slice(prefix.length), update: true, notes: (best.body || "").slice(0, 4000),
             page: best.html_url, download: asset ? asset.browser_download_url : best.html_url, prerelease: !!best.prerelease };
};
