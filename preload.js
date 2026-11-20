// The few native things the page may ask for: open / save a file through the system dialogs.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("launchpad", {
  openFile: (title, filters) => ipcRenderer.invoke("open-file", { title, filters }),
  saveFile: (title, defaultName, filters, bytes) => ipcRenderer.invoke("save-file", { title, defaultName, filters, bytes }),
  info: () => ipcRenderer.invoke("app-info"),
  appFile: (rel) => ipcRenderer.invoke("app-file", rel),
  readBackup: (p) => ipcRenderer.invoke("read-backup", p),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  openLink: (url) => ipcRenderer.invoke("open-link", url),
  busy: (on) => ipcRenderer.send("busy", !!on),
  theme: (t) => ipcRenderer.send("theme", t),
  windowAction: (act) => ipcRenderer.send("window", act),
  relaunch: () => ipcRenderer.send("relaunch"),                   // start Launchpad again (MIDI failed to start)         // "minimize" | "maximize" (toggles) | "close"
  onWindowState: (fn) => ipcRenderer.on("window-state", (_e, s) => fn(s)),
  copyText: (t) => ipcRenderer.invoke("copy-text", t),
  valetonFirmware: (version, download) => ipcRenderer.invoke("valeton-firmware", { version, download }),
  catalog: () => ipcRenderer.invoke("catalog"),                     // the firmware catalog: { index, fresh, error }
  catalogDownload: (url, sha256) => ipcRenderer.invoke("catalog-download", { url, sha256 }),   // a listed release, checked
});
