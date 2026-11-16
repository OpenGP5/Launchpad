// Render the editable SVG for packaging and the app. npm run icon [-- --preview]
const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.on("window-all-closed", () => {}); // Rendering can create more than one hidden window.

async function render(html, width, height, transparent = false) {
  const win = new BrowserWindow({ width, height, show: false, transparent, frame: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } });
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await win.webContents.executeJavaScript(`Promise.all([...document.images].map(i => i.decode())).then(() =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    if (image.isEmpty() || image.getSize().width !== width || image.getSize().height !== height) {
      throw new Error(`Expected a ${width} × ${height} icon render`);
    }
    return image.toPNG();
  } finally { win.destroy(); }
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, "build-res", "icon.svg"), "utf8");
  const png = await render(`<html><body style="margin:0;background:transparent">${svg.replace("<svg", '<svg width="1024" height="1024"')}</body></html>`, 1024, 1024, true);
  fs.mkdirSync(path.join(root, "src", "assets"), { recursive: true });
  for (const file of ["build-res/icon.png", "src/assets/app-icon.png"]) {
    fs.writeFileSync(path.join(root, file), png);
    console.log(`Rendered ${file} (1024 × 1024)`);
  }
  if (process.argv.includes("--preview")) {
    const master = nativeImage.createFromBuffer(png);
    const samples = [256, 128, 64, 48, 32, 16].map(size => ({ size,
      url: master.resize({ width: size, height: size, quality: "best" }).toDataURL() }));
    const row = (theme, background, ink) => `<section style="background:${background};color:${ink}">
      <h2>${theme}</h2><div class="sizes">${samples.map(({ size, url }) => `<figure><div class="sample"><img src="${url}" width="${size}" height="${size}"></div><figcaption>${size} px</figcaption></figure>`).join("")}</div></section>`;
    const preview = await render(`<html><head><style>
      *{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#eeeaf2;color:#201d26}
      header{height:112px;padding:28px 36px}h1{margin:0;font-size:26px;letter-spacing:-.6px}
      p{margin:7px 0 0;color:#68616f;font-size:14px}section{height:350px;padding:22px 36px}
      h2{font-size:13px;font-weight:600;margin:0 0 12px}.sizes{display:flex;align-items:flex-end;justify-content:space-between}
      figure{margin:0;text-align:center}.sample{height:256px;display:flex;align-items:center;justify-content:center;min-width:64px}
      figcaption{font-size:12px;opacity:.65;margin-top:8px}
      </style></head><body><header><h1>OpenGP5 Launchpad</h1><p>Drawn in SVG · GP-5 proportions · blue display and footswitch ring</p></header>
      ${row("Light", "#f6f3f8", "#24202c")}${row("Dark", "#161513", "#f1ece4")}</body></html>`, 1000, 812);
    fs.mkdirSync(path.join(root, "design"), { recursive: true });
    fs.writeFileSync(path.join(root, "design", "icon-preview.png"), preview);
    console.log("Rendered design/icon-preview.png");
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
