// OpenGP5 Launchpad: the window, Web MIDI (with SysEx) for the pedal, and native open / save dialogs.
// Everything that talks to the pedal runs in the page (src/), in the same JavaScript as the web flasher.
//
// Guards for a pedal that's being written to (the page reports it through "busy", services.js):
//   - one Launchpad at a time: a second one would talk to the pedal in the middle of the first one's flash;
//   - closing, quitting or reloading while busy asks first (the page's beforeunload + will-prevent-unload);
//   - the computer doesn't sleep while busy (a flash takes minutes).
const { app, BrowserWindow, Menu, dialog, shell, nativeTheme } = require("electron");
const path = require("node:path");
const appIcon = path.join(__dirname, "src", "assets", "app-icon.png");

// development only (not packaged): LAUNCHPAD_USERDATA=<folder> keeps this run's data (preferences, the catalog's copy,
// downloads) apart from the real app's
if (!app.isPackaged && process.env.LAUNCHPAD_USERDATA) app.setPath("userData", process.env.LAUNCHPAD_USERDATA);

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  let win = null;
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

  // window size / position and theme, kept between runs (the theme picks the background shown while loading)
  const { readPrefs, writePrefs } = require("./services.js");

  function createWindow() {
    const prefs = readPrefs(), b = prefs.bounds || {};
    const dark = prefs.theme === "system" ? nativeTheme.shouldUseDarkColors : prefs.theme !== "light";
    win = new BrowserWindow({
      icon: appIcon,
      width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y, minWidth: 980, minHeight: 640,
      backgroundColor: dark ? "#0b0a09" : "#f3eff6",
      // macOS: the traffic lights inset in the top bar. Windows / Linux: no system title bar or buttons; the top bar is
      // the title bar, with Launchpad's own minimise / maximise / close at its right end (services.js "window").
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      trafficLightPosition: { x: 18, y: 20 },             // the usual macOS inset; vertically centred in the 52 px top bar
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    if (prefs.maximized) win.maximize();
    // development only: LAUNCHPAD_SIM=stock (or nam, dreamcatcher, ...) opens the app with a simulated pedal
    const sim = !app.isPackaged && process.env.LAUNCHPAD_SIM;
    win.loadFile(path.join(__dirname, "src", "index.html"), sim ? { hash: `sim=${sim}` } : undefined);
    // links open in the user's browser, never inside the app
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    // the page refuses to unload while it's writing to the pedal: ask whether to stop anyway
    win.webContents.on("will-prevent-unload", (e) => {
      const r = dialog.showMessageBoxSync(win, {
        type: "warning", buttons: ["Keep going", "Stop and close"], defaultId: 0, cancelId: 0, noLink: true,
        message: "Launchpad is writing to the pedal.",
        detail: "Stopping now can leave the pedal in update mode (flash again to recover) or lose presets that were being saved. Wait until it's done.",
      });
      if (r === 1) e.preventDefault();                     // preventDefault here = let the page unload after all
    });
    const save = () => { if (!win.isDestroyed() && !win.isMinimized()) writePrefs({ bounds: win.isMaximized() ? readPrefs().bounds : win.getBounds(), maximized: win.isMaximized() }); };
    win.on("resized", save); win.on("moved", save); win.on("close", save);
    win.on("closed", () => { win = null; });
    // the page swaps its maximise / restore button
    const state = () => { if (!win.isDestroyed()) win.webContents.send("window-state", { maximized: win.isMaximized() }); };
    win.on("maximize", state); win.on("unmaximize", state); win.webContents.on("did-finish-load", state);
  }

  function menu() {
    const mac = process.platform === "darwin", dev = !app.isPackaged;
    const help = { role: "help", submenu: [
      { label: "OpenGP5 on GitHub", click: () => shell.openExternal("https://github.com/OpenGP5/OpenGP5") },
      { label: "Web flasher and recovery", click: () => shell.openExternal("https://opengp5.github.io/flasher/") },
    ] };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : [{ label: "File", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] }]),
      { role: "editMenu" },                                // copy / paste in text fields
      // no Reload: it would cut a flash short (the page guards it too, but there's no reason to offer it)
      { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
        ...(dev ? [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] : [])] },
      { role: "windowMenu" },
      help,
    ]));
    app.setAboutPanelOptions({ applicationName: "OpenGP5 Launchpad", applicationVersion: app.getVersion(),
      copyright: "Built with OpenGP5. Not affiliated with Valeton.", website: "https://github.com/OpenGP5/OpenGP5" });
  }

  app.whenReady().then(() => {
    if (!app.isPackaged && app.dock) app.dock.setIcon(appIcon);
    require("./services.js").setup();
    menu();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
