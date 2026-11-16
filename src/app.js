// OpenGP5 Launchpad: the shell. Finds the pedal (every 1.5 s), identifies what it runs, and hands the
// sections (views/) a context to work with: the state, one shared connection, dialogs and files.
// Start the page with #sim (or #sim=dreamcatcher, #sim=tuner, #sim=stock, #sim=loader) for a simulated pedal.
import { webMidiPorts } from "./lib/webmidi.js";
import { locate, identify, readStore, readControls, paramsRead, MODE_OPEN, MODE_STOCK, MODE_LOADER, MODE_SILENT } from "./lib/device.js";
import { readBank, dspCaptureCrc } from "./lib/gp5nam.js";
import { readToneFiles } from "./lib/namfiles.js";
import { listPresets, currentPreset, firmwareConstant, readGlobals, OUTPUT_LEVEL } from "./lib/stockpresets.js";
import { latest, IDS, DC, decodeDreamcatcher } from "./lib/gp5store.js";
import { icon } from "./lib/icons.js";
import home from "./views/home.js";
import flash from "./views/flash.js";
import tones from "./views/tones.js";
import presets from "./views/presets.js";
import backups from "./views/backups.js";
import mods from "./views/mods.js";
import settings, { applyTheme, savedTheme } from "./views/settings.js";
import { pedalPanel, fitScreen, setKnob } from "./views/pedal.js";

const VIEWS = [home, flash, tones, presets, backups, mods];
const ALL = [...VIEWS, settings];
const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  ports: null, sim: null,
  pedal: null,            // { name, mode, firmware: { kind, title, platform } | null }
  link: null,             // open connection (open firmware only)
  nam: null,              // { bank, playing } when the NAM player runs
  dream: null,            // decoded Dreamcatcher presets when Dreamcatcher runs
  stock: null,            // { list, current, version } or { error } when Valeton's firmware runs
  identifying: 0,         // 0..1 while reading the firmware's code
  busy: null,             // text while an operation holds the connection
  view: "home",
  problem: null,          // why there is no pedal (e.g. MIDI not allowed)
};

// ------------------------------------------------------------------ context for the views

// Recent problems, newest last (for "Copy diagnostics" in Settings): errors shown to the user and unexpected ones.
const problems = [];
function remember(text) { problems.push(`${new Date().toISOString().slice(11, 19)} ${String(text).slice(0, 300)}`); if (problems.length > 30) problems.shift(); }

const ctx = {
  state, esc, icon, problems, remember,
  // the coloured banner that opens a section: world (w-nam ...), icon, title, text, { actions: html, chips: [text] }
  banner(world, iconName, title, text, { actions = "", chips = [] } = {}) {
    return `<header class="banner ${world}"><span class="deco">${icon(iconName, 84)}</span>
      <div class="text"><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ""}${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}</header>`;
  },
  go(id) { state.view = id; render(); $("main").focus({ preventScroll: true }); },
  render: () => render(),
  // shown for a moment; read out through #toastlive, a live region that's always in the page (a freshly added
  // role=status node is often missed by screen readers)
  toast(text, ms = 3200) {
    const t = document.createElement("div"); t.className = "toast enter"; t.textContent = text; t.setAttribute("aria-hidden", "true");
    document.body.append(t); setTimeout(() => t.remove(), ms);
    const live = $("toastlive"); live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50);
  },
  // check: a box to tick before the OK button works (for what can't be undone)
  confirm(title, text, ok = "Continue", danger = false, { check = "" } = {}) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.innerHTML = `<h3>${esc(title)}</h3><p class="muted" style="margin:10px 0 ${check ? 14 : 20}px;white-space:pre-wrap;max-height:50vh;overflow:auto">${esc(text)}</p>
        ${check ? `<label class="check" style="margin-bottom:20px"><input type="checkbox" data-check><span>${esc(check)}</span></label>` : ""}
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" value="no">Cancel</button>
        <button class="btn ${danger ? "danger" : "primary"}" value="yes" ${check ? "disabled" : ""}>${esc(ok)}</button></div>`;
      d.querySelector("[data-check]")?.addEventListener("change", (e) => { d.querySelector('button[value="yes"]').disabled = !e.target.checked; });
      d.addEventListener("click", (e) => { const b = e.target.closest("button"), v = b?.value; if (v && !b.disabled) { d.close(); resolve(v === "yes"); } });
      d.addEventListener("cancel", () => resolve(false));
      d.addEventListener("close", () => d.remove());
      document.body.append(d); d.showModal();
    });
  },
  // A dialog with several answers: choices [{ value, label, primary?, danger? }] -> the value, or null (Esc)
  choose(title, text, choices) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.innerHTML = `<h3>${esc(title)}</h3><p class="muted" style="margin:10px 0 20px;white-space:pre-wrap">${esc(text)}</p>
        <div class="row" style="justify-content:flex-end">${choices.map((c) => `<button class="btn ${c.primary ? "primary" : c.danger ? "danger" : "ghost"}" value="${esc(c.value)}">${esc(c.label)}</button>`).join("")}</div>`;
      d.addEventListener("click", (e) => { const v = e.target.closest("button")?.value; if (v) { d.close(); resolve(v); } });
      d.addEventListener("cancel", () => resolve(null));
      d.addEventListener("close", () => d.remove());
      document.body.append(d); d.showModal();
    });
  },
  // { name, bytes } or null. filters: [{ name, extensions: ["nam"] }]
  async openFile(title, filters) {
    if (window.launchpad) return window.launchpad.openFile(title, filters);
    return new Promise((resolve) => {
      const i = document.createElement("input"); i.type = "file";
      i.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
      i.onchange = async () => { const f = i.files[0]; resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null); };
      i.click();
    });
  },
  // { name, path } of the saved file (path only in the desktop app), or null if cancelled
  async saveFile(title, name, filters, bytes) {
    if (window.launchpad) return window.launchpad.saveFile(title, name, filters, bytes);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return { name, path: null };
  },
  // Valeton's own firmware file ({ name, bytes }) or null: this computer's saved copy, else (asking first) a
  // download from Valeton's site, else the user picks the file. quiet: only the saved copy, never ask.
  async stockImage({ quiet = false, why = "" } = {}) {
    const lp = window.launchpad;
    if (lp?.valetonFirmware) {
      const have = await lp.valetonFirmware("1.0.6", false).catch(() => null);
      if (have || quiet) return have;
      const a = await ctx.choose("Valeton's firmware V1.0.6", `${why ? why + "\n\n" : ""}Download it from valeton.net (1.1 MB), or choose the file yourself.`,
        [{ value: "pick", label: "Choose a file" }, { value: "download", label: "Download from Valeton", primary: true }]);
      if (a === "download") {
        state.busy = "Downloading Valeton's firmware"; render();
        try { const r = await lp.valetonFirmware("1.0.6", true); ctx.toast("Downloaded Valeton's firmware V1.0.6"); return r; }
        catch (e) { await ctx.confirm("Download failed", String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "OK"); return null; }
        finally { state.busy = null; render(); }
      }
      if (a !== "pick") return null;
    } else if (quiet) return null;
    return ctx.openFile("Choose Valeton's firmware V1.0.6", [{ name: "GP-5 firmware", extensions: ["bin", "hfw"] }]);
  },
  // a file that ships with the app (e.g. firmware/manifest.json)
  async appFile(rel) {
    if (window.launchpad) return window.launchpad.appFile(rel);
    const r = await fetch(rel); if (!r.ok) throw new Error(`${rel}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  // Run fn(link) with the pedal's connection to ourselves: the background check waits (one lock for the link),
  // and the screen shows `label`. fn may call ctx.loadNam(link) / ctx.loadDream(link) to refresh what it changed.
  async withLink(label, fn) {
    if (state.busy) throw new Error("Launchpad is busy with something else. Try again in a moment.");
    state.busy = label; render();
    try {
      return await locked(async () => {
        if (!state.link) throw new Error("Connect a GP-5 first.");
        return fn(state.link);
      });
    } catch (e) { remember(`${label}: ${e.message}`); throw e; }
    finally { state.busy = null; render(); }
  },
  // Like withLink, without the busy screen (for small, frequent sends that mustn't redraw the page, e.g. a slider).
  linkQuiet(fn) {
    return locked(async () => { if (!state.link) throw new Error("Connect a GP-5 first."); return fn(state.link); });
  },
  // For flashing: the ports (the flasher opens its own connections). Waits for the background check, then closes
  // the link; nothing else touches the pedal until it's done.
  async withPorts(label, fn) {
    if (state.busy) throw new Error("Launchpad is busy with something else. Try again in a moment.");
    state.busy = label; render();
    try { return await locked(async () => { await dropLink(); render(); return fn(state.ports); }); }
    catch (e) { remember(`${label}: ${e.message}`); throw e; }
    finally { state.busy = null; state.pedal = null; render(); poll(); }
  },
  // platform 0.4+: the tones are files (and maybe some still the old way, to move); before: fixed slots
  filesMode: () => atLeast(state.pedal?.firmware?.platform, "0.4.0"),
  async loadNam(link) {
    if (ctx.filesMode()) { const t = await readToneFiles(link); state.nam = { bank: t.bank, legacy: t.legacy, files: true }; }
    else state.nam = { bank: await readBank(link), legacy: [], files: false };
    state.nam.playing = await dspCaptureCrc(link);
  },
  async loadDream(link) {
    const rec = latest(await readStore(link)).get(IDS.dreamcatcher);
    state.dream = rec ? decodeDreamcatcher(rec.data) : null;
    state.dreamUnreadable = !!rec && !state.dream;        // a record this Launchpad can't read: don't overwrite it
    // live settings (platform 0.5.4 + a Dreamcatcher that answers them); the preset version the firmware reads:
    // 3 with live settings (1.2), else what's stored (1 = 1.0 / 1.1)
    state.dreamLive = atLeast(state.pedal?.firmware?.platform, "0.5.4") && (await paramsRead(link, 0, 1))?.length === 1;
    // version 4 (names) when the firmware says so (DC.P.FORMAT); an earlier 1.2 build reads 3
    const fmt = state.dreamLive ? (await paramsRead(link, DC.P.FORMAT, 1))?.[0] : null;
    state.dreamFormat = state.dreamLive ? (fmt >= 4 ? 4 : 3) : state.dream?.version || 1;
  },
  // Valeton's firmware: the preset list (12 40), the current preset, the firmware's version constant
  async loadStock(link) {
    try { state.stock = { list: await listPresets(link), current: await currentPreset(link), version: await firmwareConstant(link) }; }
    catch (e) { state.stock = { error: e.message }; }
  },
  reloadStock() { return locked(async () => { if (state.link) await ctx.loadStock(state.link); }).finally(render); },
  reloadNam() { return locked(async () => { if (state.link) await ctx.loadNam(state.link); }).finally(render); },
  reloadDream() { return locked(async () => { if (state.link) await ctx.loadDream(state.link); }).finally(render); },
};

export function atLeast(v, want) {
  const a = String(v || "0").split(".").map((x) => parseInt(x, 10) || 0), b = want.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true;
}

// One lock for everything that talks over the link: the background check, operations, flashing.
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

async function dropLink() {
  const l = state.link; state.link = null; state.nam = null; state.dream = null; state.stock = null; state.knob = null;
  if (l) try { await l.close(); } catch { /* gone */ }
}

// ------------------------------------------------------------------ finding the pedal

let polling = false;
async function poll() {
  if (polling || state.busy || !state.ports) return;
  polling = true;
  try { await locked(pollLocked); }
  catch (e) { console.warn("poll", e); await dropLink(); state.pedal = null; state.identifying = 0; render(); }
  finally { polling = false; }
}
async function pollLocked() {
  if (state.busy) return;                                   // an operation got the lock first: it owns the pedal now
  const d = await locate(state.ports);
  const same = d && state.pedal && d.name === state.pedal.name && d.mode === state.pedal.mode;
  if (!same) {
    await dropLink();
    state.pedal = d ? { ...d, firmware: null } : null;
    state.pedalSerial = (state.pedalSerial || 0) + 1;       // views drop drafts that belong to another pedal
    render();
    if (d && d.mode === MODE_OPEN) {
      state.link = await state.ports.open(d.name);
      state.identifying = 0.01; render();
      state.pedal.firmware = await identify(state.link, (f) => { state.identifying = f; renderConn(); });
      state.identifying = 0;
      if (state.pedal.firmware.kind === "nam") await ctx.loadNam(state.link);
      if (state.pedal.firmware.kind === "dreamcatcher") await ctx.loadDream(state.link);
      render();
    } else if (d && d.mode === MODE_STOCK) {               // Valeton's firmware: read its preset list (reads only)
      state.link = await state.ports.open(d.name);
      await ctx.loadStock(state.link);
      render();
    }
  } else if (state.pedal?.firmware?.kind === "nam" && state.link && state.nam) {
    const p = await dspCaptureCrc(state.link);              // the pedal's own switching (PARA)
    if (p !== state.nam.playing) { state.nam.playing = p; render(); }
  }
}

// ------------------------------------------------------------------ the volume knob, live
// A few times a second, while the window is visible and nothing else uses the pedal: Valeton's firmware reports its
// output level (12 10, item 0x0202), which follows the VOLUME knob; OpenGP5 platform 0.5.2+ reports the knob
// itself (7E 0F). Only the drawn knob turns. On Valeton's firmware the preset the pedal is on is followed too.
let knobBusy = false, knobTick = 0;
async function knobPoll() {
  const p = state.pedal;
  if (knobBusy || state.busy || !state.link || document.hidden || !p || state.knobOff === state.pedalSerial) return;
  const stock = p.mode === MODE_STOCK && state.stock?.list, open = p.mode === MODE_OPEN && atLeast(p.firmware?.platform, "0.5.2");
  if (!stock && !open) return;
  knobBusy = true;
  try {
    await locked(async () => {
      if (state.busy || !state.link || state.pedal !== p) return;
      let v = null, cur = null;
      if (stock) {
        const g = await readGlobals(state.link);
        if (g.has(OUTPUT_LEVEL)) v = Math.min(100, Math.max(0, g.get(OUTPUT_LEVEL))) / 100;
        if (++knobTick % 4 === 0) cur = await currentPreset(state.link);
      } else {
        const c = await readControls(state.link);
        if (c) v = c.knob; else state.knobOff = state.pedalSerial;     // the platform doesn't have it after all
      }
      if (v !== null && v !== state.knob) { state.knob = v; setKnob($("panel"), v); }
      if (cur !== null && state.stock && cur !== state.stock.current) { state.stock.current = cur; renderPanel(); }
    });
  } catch { /* a missed reading: try again next time */ }
  finally { knobBusy = false; }
}
function renderPanel() { $("panel").innerHTML = pedalPanel(ctx); fitScreen($("panel")); $("panel").querySelectorAll("[data-go]").forEach((b) => b.onclick = () => ctx.go(b.dataset.go)); }

// ------------------------------------------------------------------ drawing

function renderConn() {
  const c = $("conn"), p = state.pedal;
  let dot = "", text;
  if (state.problem) text = state.problem;
  else if (!p) text = "No GP-5 connected";
  else if (state.busy) { dot = "busy"; text = state.busy; }
  else if (state.identifying) { dot = "busy"; text = `Reading the pedal… ${Math.round(state.identifying * 100)}%`; }
  else if (p.mode === MODE_OPEN) { dot = "on"; text = p.firmware?.title ?? "OpenGP5 firmware"; }      // the platform is in the pedal panel
  else if (p.mode === MODE_STOCK) { dot = "on"; text = "Valeton firmware"; }
  else if (p.mode === MODE_LOADER) { dot = "busy"; text = "GP-5 in update mode"; }
  else text = "GP-5 isn't answering";
  c.innerHTML = `<span class="dot ${dot}"></span><span>${esc(text)}</span>`;
  if ($("connlive").textContent !== text && !state.identifying) $("connlive").textContent = text;   // read out once per change
  $("connect").hidden = !state.problem;
}

// Anything that slips through: shown (not lost in the console) and kept for the diagnostics.
window.addEventListener("error", (e) => { remember(`error: ${e.message}`); ctx.toast(`Something went wrong: ${e.message}`, 6000); });
window.addEventListener("unhandledrejection", (e) => { const m = e.reason?.message || String(e.reason); remember(`error: ${m}`); ctx.toast(`Something went wrong: ${m}`, 6000); });

// While Launchpad writes to the pedal: the computer stays awake (main process) and the page won't unload (closing,
// quitting or reloading asks first: main.js will-prevent-unload).
let wasBusy = false;
window.addEventListener("beforeunload", (e) => { if (state.busy) { e.preventDefault(); e.returnValue = ""; } });

function render() {
  if (wasBusy !== !!state.busy) { wasBusy = !!state.busy; window.launchpad?.busy?.(wasBusy); }
  const v = ALL.find((x) => x.id === state.view) || home;
  document.title = v.id === "home" ? "OpenGP5 Launchpad" : `${v.title} · OpenGP5 Launchpad`;
  // only the sections the pedal can use (a view's available(state)); the open one stays, so it never vanishes under you.
  // A view's look(state) can change its rail icon and colour (Presets: Dreamcatcher's or Valeton's).
  $("rail").innerHTML = VIEWS.filter((x) => x.id === v.id || !x.available || x.available(state)).map((x) => {
    const l = { icon: x.icon, world: x.world, ...(x.look?.(state) || {}) };
    return `<button class="${l.world || ""}" data-view="${x.id}" ${x.id === v.id ? 'aria-current="page"' : ""}
      aria-label="${esc(x.title)}">${icon(l.icon, 20)}<span class="tip">${esc(x.title)}</span></button>`;
  }).join("") +
    `<span class="gap"></span><button class="plain" data-view="settings" ${v.id === "settings" ? 'aria-current="page"' : ""} aria-label="Settings">${icon("settings", 20)}<span class="tip">Settings</span></button>`;
  renderConn();
  const main = $("main");
  const html = v.render(ctx);
  if (main.dataset.view !== v.id) main.classList.remove("enter"), void main.offsetWidth, main.classList.add("enter");
  main.dataset.view = v.id;
  main.innerHTML = html;
  v.mount?.(main, ctx);
  renderPanel();
}

$("rail").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) ctx.go(b.dataset.view); });

// Narrow windows have no room for the pedal panel: the connection pill opens it as a drawer (Esc or a click outside
// closes it). Wide windows show the panel all the time; the pill does nothing there.
const narrow = matchMedia("(max-width: 1120px)");
function drawer(open) {
  $("app").classList.toggle("panel-open", open);
  $("conn").setAttribute("aria-expanded", String(open));
  if (open) $("panel").focus?.();
}
$("conn").onclick = () => { if (narrow.matches) drawer(!$("app").classList.contains("panel-open")); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("app").classList.contains("panel-open")) { drawer(false); $("conn").focus(); } });
document.addEventListener("pointerdown", (e) => { if ($("app").classList.contains("panel-open") && !e.target.closest("#panel, #conn")) drawer(false); });
narrow.addEventListener("change", () => drawer(false));
$("connect").onclick = () => start();

// ------------------------------------------------------------------ updates (Electron only)

export function updatesOn() { try { return localStorage.getItem("updates") !== "off"; } catch { return true; } }
ctx.checkUpdate = async () => {
  if (!window.launchpad?.checkUpdate) return { error: "only in the desktop app" };
  const r = await window.launchpad.checkUpdate();
  state.update = r && r.update ? r : null;
  const b = $("update");
  b.hidden = !state.update;
  if (state.update) b.textContent = `Update to ${state.update.latest}`;
  return r;
};
$("update").onclick = async () => {
  const u = state.update; if (!u) return;
  const notes = u.notes ? u.notes.replace(/\r/g, "").split("\n").slice(0, 12).join("\n") : "";
  if (await ctx.confirm(`Launchpad ${u.latest} is available`, `You have ${u.current}.${u.prerelease ? " (This is a pre-release.)" : ""}\n\n${notes}`, "Download"))
    window.launchpad.openLink(u.download);
};

// ------------------------------------------------------------------ start

applyTheme(savedTheme());                                  // Light or Dark (Dark unless chosen)
window.launchpad?.info().then((i) => {
  $("app").classList.add(i.platform === "darwin" ? "mac" : "wco"); ctx.appVersion = i.version;
  if (i.platform === "darwin") return;
  // Windows / Linux: Launchpad's own window buttons (main.js has no system title bar there)
  const box = $("winctl"), max = box.querySelector('[data-win="maximize"]');
  box.querySelector('[data-win="minimize"]').innerHTML = icon("minus", 16);
  box.querySelector('[data-win="close"]').innerHTML = icon("x", 17);
  const show = (m) => { max.innerHTML = icon(m ? "copy" : "square", m ? 15 : 13); max.title = m ? "Restore" : "Maximise"; max.setAttribute("aria-label", max.title); };
  show(false);
  box.querySelectorAll("[data-win]").forEach((b) => b.onclick = () => window.launchpad.windowAction(b.dataset.win));
  window.launchpad.onWindowState?.((s) => show(s.maximized));
  box.hidden = false;
});
ctx.appVersion = "dev";

async function start() {
  state.problem = null;
  const m = location.hash.match(/^#sim(?:=(\w+))?(?:@([\d.]+))?/);       // e.g. #sim=nam@0.4.0
  if (m) {
    const { SimPedal, fastTiming } = await import("./lib/sim.js");
    const F = await import("./lib/gp5flash.js");
    fastTiming();
    const kind = m[1] || "nam";
    const mode = kind === "stock" ? F.MODE_STOCK : kind === "loader" ? F.MODE_LOADER : F.MODE_OPEN;
    state.ports = state.sim = new SimPedal({ mode, firmware: mode === F.MODE_OPEN ? kind : "nam", platform: m[2] || "0.2.1", identity: !!m[2] && m[2] >= "0.4" });
    ctx.sim = state.sim;
    window.__launchpad = { state, ctx };                 // for testing the page with the simulated pedal only
  } else {
    try { state.ports = await webMidiPorts(); }
    catch (e) {
      state.problem = navigator.requestMIDIAccess ? "MIDI access was not allowed" : "This system offers no MIDI";
      render(); return;
    }
  }
  render();
  poll();
  setInterval(poll, 1500);
  setInterval(knobPoll, 250);
}
render();
start();
if (updatesOn() && window.launchpad?.checkUpdate) { setTimeout(() => ctx.checkUpdate(), 4000); setInterval(() => ctx.checkUpdate(), 6 * 3600 * 1000); }
