// Dreamcatcher, live: every setting of the running pedal on one screen, changed as you move it (OpenGP5 0.5.4:
// 7E 10 sets one, 7E 11 reads them). The pedal's own controls keep working: what's turned there shows up here a
// moment later. Presets load and save through the pedal's own code (DC.P.PRESET / DC.P.SAVE), as PARA does.
// The page is drawn once; after that only the changed values are updated in place, so a knob being turned is never
// replaced under the pointer. The controls are knobs, as on an instrument: drag up / down (Shift: finer), the
// scroll wheel or the keys; double-click puts a setting back to its default. Two-way choices are a small toggle.
import { DC } from "../lib/gp5store.js";
import { paramSet, paramsRead } from "../lib/device.js";
import { SECTIONS, ITEMS, liveId, valueText, itemName } from "../lib/dcformat.js";

const L = {
  serial: -1, vals: null, preset: 0, used: 0, changed: 0,
  local: new Map(),        // key -> time of the last change made here (the pedal's reading waits a moment for it)
  queue: new Map(),        // live id -> value still to send (the latest wins)
  sending: false, drag: null, timer: null, ctx: null, error: null, wasChanged: 0, rowKey: "",
  draftDirty: false,       // the slot cards below have unwritten changes: hold the live Save (one save at a time)
};
const POLL_MS = 350, HOLD_MS = 1200;
const idx = (key) => (key === "volume" ? DC.VOL : DC.ID[key]);
const cap = (s) => s[0] + s.slice(1).toLowerCase();
// names as people say them (the pedal's screen shows them in capitals, shortened)
const NICE = { "LOOP LV": "Loop level", "PRE-DLY": "Pre-delay", BPM: "BPM" };
const nice = (it, v) => { const n = itemName(it, v); return NICE[n] || cap(n); };
// what a screen reader hears: the section with the name ("Reverb mix", not a second "MIX"), units spoken
function aname(it, v) {
  if (it.key === "modType") return "Modulation type";
  return `${cap(SECTIONS[it.sec].name)} ${nice(it, v).toLowerCase()}`;
}
const spoken = (t) => t.replace(/(\d)MS\b/, "$1 ms").replace(/(\d)S\b/, "$1 s").replace(/(\d)HZ\b/, "$1 Hz").replace(/(\d)K\b/, "$1 kHz");

// Panels in reading order of the wide layout: Main, Wet, Grain / Color / Mod, Loop, Reverb (styles.css places them)
const PANEL_ORDER = [0, 1, 2, 4, 3, 5, 6];

// A knob: a 270-degree arc from 7 to 5 o'clock, the value's part in the section's colour, a pointer.
const R = 21, CIRC = 2 * Math.PI * R, SWEEP = 0.75;
const frac = (it, x) => (it.n > 1 ? (x - it.lo) / (it.n - 1) : 0);
// SYNC and BPM (Dreamcatcher 1.4): only when the pedal has them
const shown = (it) => !(it.key === "sync" || it.key === "bpm") || L.hasSync;
const knobArc = (f) => `${(CIRC * SWEEP * f).toFixed(2)} ${CIRC.toFixed(2)}`;
const pointer = (f) => -135 + 270 * f;

function control(ctx, it) {
  const { esc } = ctx, v = L.vals, x = v[idx(it.key)];
  const name = nice(it, v), t = valueText(it.key, x, v);
  if (it.choices && it.n === 2) {                      // a two-way toggle
    return `<div class="dck dck-toggle" data-dc="${it.key}"><div class="seg" role="radiogroup" aria-label="${esc(aname(it, v))}">${it.choices.map((c, i) =>
      `<button type="button" role="radio" aria-checked="${i === x}" tabindex="${i === x ? 0 : -1}" data-val="${i}">${esc(cap(c))}</button>`).join("")}</div>
      <span class="dck-name">${esc(name)}</span></div>`;
  }
  const f = frac(it, x);
  return `<div class="dck" data-dc="${it.key}">
    <div class="dck-knob" role="slider" tabindex="0" aria-label="${esc(aname(it, v))}" aria-valuemin="${it.lo}" aria-valuemax="${it.lo + it.n - 1}"
      aria-valuenow="${x}" aria-valuetext="${esc(spoken(t))}" title="Drag or scroll to turn. Double-click to reset.">
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle class="dck-track" cx="28" cy="28" r="${R}" stroke-dasharray="${knobArc(1)}" transform="rotate(135 28 28)"/>
        <circle class="dck-val" cx="28" cy="28" r="${R}" stroke-dasharray="${knobArc(f)}" transform="rotate(135 28 28)"/>
        <circle class="dck-cap" cx="28" cy="28" r="14"/>
        <line class="dck-ptr" x1="28" y1="28" x2="28" y2="17" transform="rotate(${pointer(f).toFixed(1)} 28 28)"/>
      </svg></div>
    <span class="dck-value" data-v>${esc(t)}</span><span class="dck-name">${esc(name)}</span></div>`;
}

const slotName = (i) => L.ctx?.state.dream?.names?.[i] || "";          // on the pedal (preset version 4)
function slotsRow(ctx) {
  const { icon, esc } = ctx;
  const cells = Array.from({ length: DC.SLOTS }, (_, i) => {
    const used = (L.used >> i) & 1, act = i === L.preset && used, nm = used ? slotName(i) : "";
    const label = `${esc(nm || `P${i + 1}`)}${act && L.changed ? "*" : ""}`;
    const what = used ? (act ? "The preset playing" + (L.changed ? " (changed since saved)" : "") : "Load it") : "Empty slot";
    return `<button type="button" class="dcslot ${used ? "used" : ""} ${act ? "on" : ""} ${nm ? "named" : ""}" data-load="${i}" ${used ? "" : "disabled"}
      aria-pressed="${!!act}" aria-label="P${i + 1}${nm ? `, ${esc(nm)}` : ""}" title="P${i + 1}${nm ? ` · ${esc(nm)}` : ""}: ${what}">${label}</button>`;
  }).join("");
  const opts = Array.from({ length: DC.SLOTS }, (_, i) => `<option value="${i}" ${i === L.preset ? "selected" : ""}>P${i + 1}${(L.used >> i) & 1 ? (slotName(i) ? ` ${esc(slotName(i))}` : "") : " (empty)"}</option>`).join("");
  return `<div class="dcslots" data-slots><span class="fader-name" style="flex:none">Presets</span>${cells}
    <span style="flex:1"></span>
    <label class="row" style="gap:8px"><span class="faint" style="font-size:12.5px">Save into</span>
      <select data-saveto aria-label="Slot to save the sound into" style="width:148px;height:32px">${opts}</select></label>
    <button type="button" class="btn small primary" data-save ${L.draftDirty ? 'disabled aria-describedby="dcsave-why"' : ""}>${icon("device-floppy", 15)} Save</button>
    ${L.draftDirty ? '<span class="faint" id="dcsave-why" style="flex-basis:100%;text-align:right;font-size:12.5px">Write or undo the slot changes below first.</span>' : ""}</div>`;
}

function statusChips() {
  const v = L.vals, c = [];
  if (v[DC.ID.catch] === 1) c.push(v[DC.ID.overdub] ? "Overdubbing" : "Loop playing");
  else if (v[DC.ID.catch] === 2) c.push("Loop caught");
  if (v[DC.ID.freeze]) c.push("Frozen");
  return c.map((t) => `<span class="pill world">${t}</span>`).join("");
}

export function renderLive(ctx, { draftDirty = false } = {}) {
  const { state, icon, esc } = ctx;
  L.draftDirty = draftDirty;
  if (state.pedalSerial !== L.serial) { L.serial = state.pedalSerial; L.vals = null; L.local.clear(); L.queue.clear(); L.error = null; }
  L.ctx = ctx; L.rowKey = rowKey();
  if (!L.vals) {
    return `<section class="card w-dream" data-dclive><div class="card-head"><h2>${icon("adjustments-horizontal", 18)} Live</h2></div>
      <p class="muted">Reading the pedal's settings…</p></section>`;
  }
  const on = L.vals[DC.ID.on];
  return `<section class="card w-dream dclive" data-dclive>
    <div class="card-head"><h2>${icon("adjustments-horizontal", 18)} Live</h2>
      <div class="row" style="gap:8px"><span data-status class="row" style="gap:6px">${statusChips()}</span>
        <label class="row" style="gap:8px;font-size:13px;font-weight:650;cursor:pointer">Effect
          <input type="checkbox" class="switch" role="switch" data-on ${on ? "checked" : ""} aria-label="Effect on"></label></div></div>
    <p class="muted" style="margin:-4px 0 12px;font-size:13px">Changes go to the pedal as you make them. Save stores the sound in a preset slot.</p>
    <div data-dcerr>${errorNote(ctx)}</div>
    ${slotsRow(ctx)}
    <div class="dcsecs-wrap"><div class="dcsecs">${PANEL_ORDER.map((si) => { const s = SECTIONS[si]; return `<section class="dcsec dcsec-${s.name.toLowerCase()}" style="--c:${s.c}" aria-label="${cap(s.name)}">
      <h3 class="dcsec-head"><i aria-hidden="true"></i>${cap(s.name)}</h3>
      <div class="dck-row">${ITEMS.filter((it) => it.sec === si && shown(it)).map((it) => control(ctx, it)).join("")}</div></section>`; }).join("")}</div></div>
  </section>`;
}

function errorNote(ctx) {
  return L.error ? `<div class="note bad" style="margin-bottom:12px">${ctx.icon("alert-triangle", 16)}<span>${ctx.esc(L.error)}</span></div>` : "";
}
// a problem talking to the pedal: shown in the editor at once and read out (the app's toast is a live region)
function showError(msg) {
  if (L.error === msg) return;
  L.error = msg;
  const el = document.querySelector("[data-dcerr]");
  if (el) el.innerHTML = errorNote(L.ctx);
  if (msg) L.ctx.toast(msg, 6000);
}
const rowKey = () => `${L.preset}/${L.used}/${L.changed}/${L.draftDirty}/${(L.ctx?.state.dream?.names || []).join("|")}`;

// ---- after drawing: wire the controls; keep the values in step with the pedal

function refresh(root) {                     // values, texts, names (some depend on others) in place
  const v = L.vals;
  for (const it of ITEMS) {
    const el = root.querySelector(`[data-dc="${it.key}"]`); if (!el) continue;
    const x = v[idx(it.key)];
    el.querySelector(".dck-name").textContent = nice(it, v);
    if (it.choices && it.n === 2) {
      el.querySelector(".seg").setAttribute("aria-label", aname(it, v));
      el.querySelectorAll("[data-val]").forEach((b) => { const on = +b.dataset.val === x; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
      continue;
    }
    const k = el.querySelector(".dck-knob"), t = valueText(it.key, x, v), f = frac(it, x);
    el.querySelector(".dck-val").setAttribute("stroke-dasharray", knobArc(f));
    el.querySelector(".dck-ptr").setAttribute("transform", `rotate(${pointer(f).toFixed(1)} 28 28)`);
    el.querySelector("[data-v]").textContent = t;
    k.setAttribute("aria-valuenow", String(x)); k.setAttribute("aria-valuetext", spoken(t)); k.setAttribute("aria-label", aname(it, v));
  }
  const sw = root.querySelector("[data-on]"); if (sw) sw.checked = !!v[DC.ID.on];
  const st = root.querySelector("[data-status]"); if (st) st.innerHTML = statusChips();
  const row = root.querySelector("[data-slots]"), key = rowKey();
  if (row && key !== L.rowKey) {                 // only when it changed: an open menu in it stays open
    L.rowKey = key;
    const tmp = document.createElement("div"); tmp.innerHTML = slotsRow(L.ctx); row.replaceWith(tmp.firstElementChild); wireSlots(root);
  }
}

function send(id, value) {
  L.queue.set(id, value);
  if (!L.sending) flush();
}
async function flush() {
  L.sending = true;
  try {
    while (L.queue.size) {
      const [id, value] = L.queue.entries().next().value;
      L.queue.delete(id);
      const ok = await L.ctx.linkQuiet((link) => paramSet(link, id, value));
      showError(ok ? null : "The pedal didn't take a change. Is it still running this Dreamcatcher?");
    }
  } catch (e) { showError(`Couldn't reach the pedal: ${e.message}`); }
  finally { L.sending = false; }
}

function change(root, key, x) {
  L.vals[idx(key)] = x;
  L.local.set(key, Date.now());
  refresh(root);
  send(liveId(key), x);
}

async function read(force) {
  const ctx = L.ctx;
  if (!ctx || ctx.state.busy || L.sending || L.queue.size || (L.drag && !force)) return;
  const got = await ctx.linkQuiet(async (link) => {
    const a = await paramsRead(link, 0, DC.VOL), b = await paramsRead(link, DC.P.VOLUME, 4);
    return a && b && (a.length === DC.VOL || a.length === DC.ID.sync) && b.length === 4 ? { a, b } : null;   // 1.3: no SYNC / BPM
  }).catch(() => null);
  if (!got) return;
  const first = !L.vals, hadSync = L.hasSync;
  if (first) L.vals = DC.DEFAULTS.slice();
  L.hasSync = got.a.length === DC.VOL;
  const now = Date.now();
  ITEMS.concat([{ key: "on" }, { key: "catch" }, { key: "freeze" }, { key: "overdub" }]).forEach(({ key }) => {
    if (!force && now - (L.local.get(key) || 0) < HOLD_MS) return;         // just changed here: the pedal catches up
    if (key !== "volume" && DC.ID[key] >= got.a.length) return;           // (an older Dreamcatcher hasn't it)
    L.vals[idx(key)] = key === "volume" ? got.b[0] : got.a[DC.ID[key]];
  });
  const [, preset, used, changed] = got.b;
  const savedOnPedal = L.wasChanged && !changed && preset === L.preset && used === L.used;   // PARA click: saved
  const usedNow = used !== L.used;
  Object.assign(L, { preset, used, changed, wasChanged: changed });
  const root = document.querySelector("[data-dclive]");
  if (first || hadSync !== L.hasSync) { ctx.render(); return; }
  if (root) refresh(root);
  if ((usedNow || savedOnPedal) && !first) ctx.reloadDream();             // the slot cards below follow
}

function wireSlots(root) {
  root.querySelectorAll("[data-load]").forEach((b) => b.onclick = async () => {
    const i = +b.dataset.load;
    const ok = await L.ctx.linkQuiet((link) => paramSet(link, DC.P.PRESET, i)).catch(() => false);
    if (!ok) { showError(`The pedal couldn't load P${i + 1}.`); return; }
    showError(null); L.ctx.toast(`Loaded P${i + 1}`);
    L.local.clear(); await read(true);
  });
  root.querySelector("[data-save]")?.addEventListener("click", async () => {
    const i = +root.querySelector("[data-saveto]").value;
    if ((L.used >> i) & 1 && i !== L.preset &&
        !(await L.ctx.confirm(`Save into P${i + 1}?`, `P${i + 1} already holds a sound; it's replaced by this one.`, "Save"))) return;
    while (L.sending || L.queue.size) await new Promise((r) => setTimeout(r, 30));     // the last changes first
    const ok = await L.ctx.linkQuiet((link) => paramSet(link, DC.P.SAVE, i)).catch(() => false);
    if (!ok) { showError("The pedal couldn't save that preset."); return; }
    showError(null); L.ctx.toast(`Saved into P${i + 1}`);
    await read(true);
    L.ctx.reloadDream();
  });
}

// A knob's input: vertical drag (200 px = the whole range; Shift: 4x finer), wheel, keys, double-click = default
function wireKnob(box, k, it) {
  const max = it.n - 1, lo = it.lo, set = (x) => { x = Math.max(lo, Math.min(lo + max, Math.round(x))); if (x !== L.vals[idx(it.key)]) change(box, it.key, x); };
  let y0 = 0, x0 = 0, pid = null;
  k.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); k.focus();
    try { k.setPointerCapture(e.pointerId); } catch { /* keep turning without capture */ }
    pid = e.pointerId; L.drag = it.key; y0 = e.clientY; x0 = L.vals[idx(it.key)]; k.classList.add("turning");
  });
  k.addEventListener("pointermove", (e) => {
    if (L.drag !== it.key || e.pointerId !== pid) return;
    const d = (y0 - e.clientY) * (e.shiftKey ? 0.25 : 1);
    set(x0 + (d / 200) * Math.max(max, 8));               // few-step knobs still need some travel per step
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    try { k.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    pid = null; if (L.drag === it.key) L.drag = null; k.classList.remove("turning");
  };
  k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up);
  k.addEventListener("wheel", (e) => {
    e.preventDefault();
    const step = max > 32 ? (e.shiftKey ? 1 : 3) : 1;
    set(L.vals[idx(it.key)] + (e.deltaY < 0 ? step : -step));
  }, { passive: false });
  k.addEventListener("keydown", (e) => {
    const x = L.vals[idx(it.key)], big = max > 32 ? 16 : 1;
    const to = { ArrowUp: x + 1, ArrowRight: x + 1, ArrowDown: x - 1, ArrowLeft: x - 1, PageUp: x + big, PageDown: x - big, Home: lo, End: lo + max }[e.key];
    if (to === undefined) return;
    e.preventDefault(); set(to);
  });
  k.addEventListener("dblclick", () => set(DC.DEFAULTS[idx(it.key)]));
}

export function mountLive(root, ctx) {
  L.ctx = ctx;
  const box = root.querySelector("[data-dclive]");
  if (!L.timer) L.timer = setInterval(() => {
    if (!document.querySelector("[data-dclive]") || !L.ctx?.state.dreamLive) { clearInterval(L.timer); L.timer = null; return; }
    if (!document.hidden) read(false);
  }, POLL_MS);
  if (!box || !L.vals) { if (!L.vals) read(true); return; }
  for (const it of ITEMS) {
    const el = box.querySelector(`[data-dc="${it.key}"]`); if (!el) continue;
    if (it.choices && it.n === 2) {            // a radio group: one Tab stop, arrows move and select
      const btns = [...el.querySelectorAll("[data-val]")];
      btns.forEach((b) => b.onclick = () => change(box, it.key, +b.dataset.val));
      el.querySelector(".seg").addEventListener("keydown", (e) => {
        const cur = L.vals[idx(it.key)], n = btns.length;
        const to = { ArrowRight: cur + 1, ArrowDown: cur + 1, ArrowLeft: cur - 1, ArrowUp: cur - 1, Home: 0, End: n - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        const x = (to + n) % n;
        change(box, it.key, x); btns[x].focus();
      });
      continue;
    }
    wireKnob(box, el.querySelector(".dck-knob"), it);
  }
  box.querySelector("[data-on]")?.addEventListener("change", (e) => change(box, "on", e.target.checked ? 1 : 0));
  wireSlots(box);
}
