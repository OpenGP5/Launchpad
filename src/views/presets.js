// Presets: Dreamcatcher's 8 presets (stored by the firmware in the platform store, record "DRMC"), and, when the
// pedal runs Valeton's firmware, Valeton's 100 presets (views/stock.js).
// Changes are made on a draft and written in one go. Platform 0.2.2 tells Dreamcatcher to reload them; on older
// firmware the pedal is restarted afterwards. Before writing, the pedal's presets are read again: if they changed
// since the draft was made (saved on the pedal meanwhile), nothing is written.
import { MODE_STOCK, storeSave, readStore } from "../lib/device.js";
import { IDS, DC, dcName, encodeDreamcatcher, decodeDreamcatcher, latest } from "../lib/gp5store.js";
import { renderStock, mountStock } from "./stock.js";
import { renderLive, mountLive } from "./dclive.js";

const ui = { draft: null, base: null, baseFrom: null, serial: -1, result: null, needRestart: false };
// the bars on a slot card: a few settings that tell sounds apart, 1.2's grains and reverb included (index in DC.PARAMS)
const BARS = [["MIX", 1], ["TIME", 9], ["SMEAR", 10], ["CHANCE", 11], ["GRAIN", 19], ["PITCH", 20], ["DISSOLVE", 16], ["FILTER", 18], ["REVERB", 29]];
const SHAPES = ["sine", "square", "ramp", "saw", "random sine", "random square", "envelope"];
const CLOCK_HZ = ["1.4k", "2.8k", "4.2k", "5.5k", "8k", "11k", "16k", "22k", "29k", "35k", "44.1k"];

const key = (v) => v.join(",");
const cap = (l) => l[0] + l.slice(1).toLowerCase(), pct = (x) => Math.round(x / 2.55);
function names() { try { return JSON.parse(localStorage.getItem("dc-names") || "{}"); } catch { return {}; } }
// Where a slot's name lives: on the pedal (preset version 4: part of the draft, written with the presets) or, with
// older Dreamcatchers, on this computer (keyed by the sound)
const onPedal = (ctx) => ctx.state.dreamFormat >= 4;
function nameOf(ctx, d, i) { return onPedal(ctx) ? d.names?.[i] || "" : (d.slots[i] && names()[key(d.slots[i])]) || ""; }
function setNameAt(ctx, d, i, n) {
  if (!onPedal(ctx)) { setName(d.slots[i], n.trim()); return false; }
  d.names = d.names || Array(DC.SLOTS).fill("");
  d.names[i] = dcName(n);
  return true;                                   // the draft changed
}
function setName(v, n) { try { const m = names(); if (n) m[key(v)] = n; else delete m[key(v)]; localStorage.setItem("dc-names", JSON.stringify(m)); } catch { /* no storage */ } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function presetFile(v, name) {
  const o = { format: "dreamcatcher-preset", version: 2, name: name || null, values: Object.fromEntries(DC.PARAMS.map((p, i) => [p, v[i]])) };
  return new TextEncoder().encode(JSON.stringify(o, null, 1) + "\n");
}
function readPresetFile(bytes) {
  let o;
  try { o = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("This isn't a Dreamcatcher preset file."); }
  if (!o || o.format !== "dreamcatcher-preset" || !o.values || typeof o.values !== "object") throw new Error("This isn't a Dreamcatcher preset file.");
  // settings a file doesn't have (made before 1.2) take their defaults, except the reverb: off, so it sounds as saved
  const missing = (p, i) => (p === "reverbMix" ? 0 : DC.DEFAULTS[i]);
  return { values: DC.PARAMS.map((p, i) => Math.min(Math.max(Number.isInteger(o.values[p]) ? o.values[p] : missing(p, i), 0), DC.MAX[i])),
           name: typeof o.name === "string" ? o.name.slice(0, 40) : null };
}

function card(ctx, v, i) {
  const { esc, icon } = ctx, d = ui.draft;
  if (!v) return `<div class="preset empty"><div class="head"><b>P${i + 1}</b><span class="faint" style="font-size:12px">empty</span></div>
      <span></span>
      <div class="tools"><button class="btn small" data-import="${i}">${icon("file-import", 15)} Import</button></div></div>`;
  const nm = nameOf(ctx, d, i), pedal = onPedal(ctx);
  return `<div class="preset ${d.last === i ? "loaded" : ""}">
    <div class="head"><b>P${i + 1}</b>${d.last === i ? '<span class="pill world">starts here</span>' : ""}</div>
    <input type="text" data-name="${i}" value="${esc(nm)}" placeholder="Add a name" aria-label="Name of preset ${i + 1}" ${pedal ? `maxlength="${DC.NAME_LEN}" title="Up to ${DC.NAME_LEN} characters, shown on the pedal"` : 'title="Names are kept on this computer"'}>
    <div><div class="bars" role="img" aria-label="${BARS.map(([l, k]) => `${cap(l)} ${pct(v[k])} %`).join(", ")}">${BARS.map(([l, k]) => `<i style="height:${Math.max(5, Math.round(v[k] / 255 * 100))}%" title="${cap(l)} ${pct(v[k])} %"></i>`).join("")}</div>
      <div class="bars-label" aria-hidden="true">${BARS.map(([l]) => `<span>${l.slice(0, 3)}</span>`).join("")}</div></div>
    <p class="desc">${v[4] ? "Stretch" : "Tape"} loop · clock ${CLOCK_HZ[v[2]]} · ${SHAPES[v[14]]} ${v[15] ? "vibrato" : "tremolo"} · ${v[DC.ID.reverbMix] ? `reverb ${pct(v[DC.ID.reverbMix])}%` : "no reverb"} · vol ${pct(v[DC.VOL])}%</p>
    <div class="tools">
      <button class="btn small ghost icon-only" data-move="${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Move left" title="Move left">${icon("arrow-left", 15)}</button>
      <button class="btn small ghost icon-only" data-move="${i}:1" ${i === DC.SLOTS - 1 ? "disabled" : ""} aria-label="Move right" title="Move right">${icon("arrow-right", 15)}</button>
      <span style="flex:1"></span>
      <button class="btn small ghost icon-only" data-export="${i}" aria-label="Export preset ${i + 1}" title="Export">${icon("file-export", 15)}</button>
      <button class="btn small ghost icon-only danger" data-clear="${i}" aria-label="Clear preset ${i + 1}" title="Clear">${icon("trash", 15)}</button>
    </div></div>`;
}

export default {
  id: "presets", title: "Presets", icon: "sparkles", world: "w-dream",
  available: (state) => state.pedal?.mode === MODE_STOCK || state.pedal?.firmware?.kind === "dreamcatcher",
  look: (state) => (state.pedal?.mode === MODE_STOCK ? { icon: "adjustments-horizontal", world: "w-stock" } : null),
  render(ctx) {
    const { state, icon, esc } = ctx, p = state.pedal, fw = p?.firmware?.kind;
    if (state.pedalSerial !== ui.serial) {                 // another pedal (or a reconnect): drop the old draft
      ui.serial = state.pedalSerial; ui.draft = ui.base = ui.baseFrom = null; ui.result = null; ui.needRestart = false;
    }
    if (p?.mode === MODE_STOCK) {
      return renderStock(ctx);
    }
    const isDream = fw === "dreamcatcher";
    if (isDream && !state.dreamUnreadable) {
      const cur = state.dream || { last: 0, slots: Array(DC.SLOTS).fill(null), names: Array(DC.SLOTS).fill("") };
      if (!ui.draft || (ui.baseFrom !== state.dream && same(ui.draft, ui.base))) { ui.base = structuredClone(cur); ui.draft = structuredClone(cur); ui.baseFrom = state.dream; }
    }
    const dirty = ui.draft && !same(ui.draft, ui.base);
    const actions = isDream && ui.draft ? `${dirty ? '<button class="btn" data-act="revert">Undo changes</button>' : ""}
      <button class="btn primary" data-act="write" ${dirty && !state.busy ? "" : "disabled"}>${icon("device-floppy", 16)} Write to pedal</button>` : "";
    const saved = state.dream ? state.dream.slots.filter(Boolean).length : 0;
    const head = ctx.banner("w-dream", "sparkles", "Dreamcatcher presets", "",
      { actions, chips: isDream && state.dream ? [`${saved} of 8 saved`, `starts on P${state.dream.last + 1}`] : [] });
    if (!isDream) {
      return head + `<section class="card w-dream" style="max-width:640px"><div class="card-head"><h2>${p ? "The pedal isn't running Dreamcatcher" : "No pedal connected"}</h2></div>
        <p class="muted">Flash Dreamcatcher to manage its presets.</p>
        <div style="margin-top:12px"><button class="btn primary" data-go="flash">${icon("bolt", 16)} Go to Flash</button></div></section>`;
    }
    if (state.dreamUnreadable) {
      return head + `<div class="note warn">${icon("alert-triangle", 16)}<span>This Dreamcatcher stores its presets in a newer format than this Launchpad knows. Update Launchpad to manage them; nothing was changed.</span></div>`;
    }
    return head + `<div class="w-dream stack">
      ${ui.needRestart ? `<div class="note warn">${icon("refresh", 16)}<span><b>Restart the pedal now</b> (unplug it, plug it back in) so Dreamcatcher loads the new presets. Until then, don't save a preset on the pedal: it would write its old ones back.</span></div>` : ""}
      ${ui.result ? `<div class="note ${ui.result.ok ? "good" : "bad"}">${icon(ui.result.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(ui.result.text)}</span></div>` : ""}
      ${state.dreamLive ? renderLive(ctx, { draftDirty: dirty })
        : `<div class="note">${icon("info-circle", 16)}<span>Live editing needs Dreamcatcher 1.2. <button class="btn small" data-go="flash">Go to Flash</button></span></div>`}
      <div class="card-head" style="margin:4px 0 0;flex-wrap:wrap"><h2>${icon("layout-grid", 18)} Preset slots</h2>
        <span class="faint" style="font-size:13px">Changes to the slots are saved with <b>Write to pedal</b>.${state.dreamLive ? " <b>Save</b> above stores the current sound." : ""}</span></div>
      <div class="presets">${ui.draft.slots.map((v, i) => card(ctx, v, i)).join("")}</div></div>`;
  },
  mount(root, ctx) {
    if (ctx.state.pedal?.mode === MODE_STOCK) return mountStock(root, ctx);
    root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => ctx.go(b.dataset.go));
    const d = ui.draft;
    if (!d || ctx.state.pedal?.firmware?.kind !== "dreamcatcher") return;
    if (ctx.state.dreamLive) mountLive(root, ctx);
    const changed = () => { ui.result = null; ctx.render(); };
    root.querySelectorAll("[data-move]").forEach((b) => b.onclick = () => {
      const [i, dir] = b.dataset.move.split(":").map(Number), j = i + dir;
      [d.slots[i], d.slots[j]] = [d.slots[j], d.slots[i]];
      if (d.names) [d.names[i], d.names[j]] = [d.names[j], d.names[i]];
      if (d.last === i) d.last = j; else if (d.last === j) d.last = i;
      changed();
    });
    root.querySelectorAll("[data-clear]").forEach((b) => b.onclick = () => { const i = +b.dataset.clear; d.slots[i] = null; if (d.names) d.names[i] = ""; changed(); });
    root.querySelectorAll("[data-name]").forEach((inp) => inp.onchange = () => { if (setNameAt(ctx, d, +inp.dataset.name, inp.value)) changed(); });
    root.querySelectorAll("[data-export]").forEach((b) => b.onclick = async () => {
      const i = +b.dataset.export, v = d.slots[i], nm = nameOf(ctx, d, i);
      const saved = await ctx.saveFile("Export preset", `${(nm || "Dreamcatcher P" + (i + 1)).replace(/[\\/:*?"<>|]/g, "")}.dcpreset`,
        [{ name: "Dreamcatcher preset", extensions: ["dcpreset"] }], presetFile(v, nm));
      if (saved) ctx.toast(`Saved ${saved.name}`);
    });
    root.querySelectorAll("[data-import]").forEach((b) => b.onclick = async () => {
      const f = await ctx.openFile("Import a Dreamcatcher preset", [{ name: "Dreamcatcher preset", extensions: ["dcpreset"] }]);
      if (!f) return;
      try { const { values, name } = readPresetFile(f.bytes), i = +b.dataset.import; d.slots[i] = values; if (name) setNameAt(ctx, d, i, name); changed(); }
      catch (e) { ui.result = { ok: false, text: e.message }; ctx.render(); }
    });
    root.querySelector('[data-act="revert"]')?.addEventListener("click", () => { ui.draft = structuredClone(ui.base); changed(); });
    root.querySelector('[data-act="write"]')?.addEventListener("click", async () => {
      if (!(await ctx.confirm("Write these presets to the pedal?", "The 8 presets on the pedal are replaced by these.", "Write"))) return;
      if (d.slots[d.last] === null) d.last = Math.max(0, d.slots.findIndex(Boolean));
      try {
        const { reloaded } = await ctx.withLink("Writing presets", async (link) => {
          if (ctx.state.pedal?.firmware?.kind !== "dreamcatcher") throw new Error("The pedal isn't running Dreamcatcher any more. Nothing was written.");
          const rec = latest(await readStore(link)).get(IDS.dreamcatcher);
          if (!same(rec ? decodeDreamcatcher(rec.data) : null, ui.baseFrom))
            throw new Error("The presets on the pedal changed since you opened them (saved on the pedal?). Nothing was written: undo your changes to start from what's there now.");
          const r = await storeSave(link, IDS.dreamcatcher, encodeDreamcatcher(d, ctx.state.dreamFormat));
          await ctx.loadDream(link);
          return r;
        });
        ui.base = structuredClone(d); ui.baseFrom = ctx.state.dream; ui.needRestart = !reloaded;
        ui.result = { ok: true, text: reloaded ? "The presets are on the pedal, and Dreamcatcher is using them." : "The presets are on the pedal." };
      } catch (e) {
        ui.result = { ok: false, text: e.message };
        if (/changed since/.test(e.message)) { await ctx.reloadDream(); ui.base = structuredClone(ctx.state.dream || ui.base); ui.baseFrom = ctx.state.dream; }
      }
      ctx.render();
    });
  },
};

export { presetFile, readPresetFile };
