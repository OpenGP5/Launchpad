// Valeton presets (the Presets section while the pedal runs Valeton's firmware): the 100 presets, and an editor
// for one of them. Protocol: lib/stockpresets.js; models and parameters: lib/stockcat.js, read from the user's
// own Valeton firmware file (Launchpad ships none of Valeton's data).
//
// Editing happens on a draft. "Save to pedal" writes the whole preset (one 4 KB flash sector, 11 4F) and reads it
// back. "Hear it live" makes the pedal play the preset and sends each change to its edit buffer only (RAM): the
// pedal's own preset stays as it was until saved.
import * as S from "../lib/stockpresets.js";
import { catalogFromImage, loadSavedCatalog, saveCatalog, modelFor, formatValue, snap, BLOCK_NAMES, BLOCK_SHORT, hex } from "../lib/stockcat.js";

const ui = { banks: null, banksFor: null, wipe: null, sel: null, base: null, draft: null, block: null, live: false, result: null, filter: "", cat: undefined, serial: -1, busyText: null };
const clone = (p) => structuredClone(p);
const two = S.label;
const catalog = () => (ui.cat === undefined ? (ui.cat = loadSavedCatalog()) : ui.cat);

function dirty() { return ui.draft && ui.base && !S.samePreset(ui.draft, ui.base); }

// ------------------------------------------------------------------ drawing

function listCard(ctx) {
  const { esc, icon, state } = ctx, st = state.stock, f = ui.filter.trim().toLowerCase();
  const rows = (st?.list || []).filter((p) => !f || p.name.toLowerCase().includes(f) || two(p.n).includes(f));
  return `<section class="card w-stock" style="display:flex;flex-direction:column;min-height:0">
    <div class="card-head"><h2>${icon("list", 18)} On the pedal</h2>
      <button class="btn small ghost icon-only" data-act="reload" aria-label="Read the list again" title="Read the list again">${icon("refresh", 15)}</button></div>
    <input type="text" data-filter placeholder="Find a preset" value="${esc(ui.filter)}" aria-label="Find a preset" style="margin-bottom:10px">
    <div class="list" data-list role="listbox" aria-label="Presets on the pedal" style="overflow:auto;flex:1 1 0;min-height:240px">
      ${rows.map((p, i) => `<div class="item pick ${ui.sel === p.n ? "sel" : ""}" data-sel="${p.n}" role="option" aria-selected="${ui.sel === p.n}"
        tabindex="${(rows.some((r) => r.n === ui.sel) ? ui.sel === p.n : i === 0) ? 0 : -1}">
        <span class="n">${two(p.n)}</span><span class="main"><span class="name">${esc(p.name || "(no name)")}</span></span>
        ${st.current === p.n ? '<span class="pill world">playing</span>' : ""}</div>`).join("") || '<p class="muted" style="padding:12px" role="presentation">No match.</p>'}
    </div></section>`;
}

// Each block in Valeton's own colours (as in Valeton Suite's chain) with a Tabler icon. The SnapTone block (N→S)
// replaces amp + cab: while it's on, those two are shown crossed out (and are off).
const BLOCK_ICON = ["volume-off", "bolt", "flame", "gauge", "device-speaker", "adjustments", "wave-sine", "repeat", "ripple", "capture"];
const SNAP = 9, AMP = 3, CAB = 4;
function chain(ctx) {
  const { esc, icon } = ctx, d = ui.draft, cat = catalog(), snapOn = !!(d.mask & (1 << SNAP));
  return `<div class="chain" role="list">${d.order.map((b) => {
    const m = cat ? modelFor(cat, b, d.models[b]) : null, on = !!(d.mask & (1 << b)), crossed = snapOn && (b === AMP || b === CAB);
    const tip = `${BLOCK_NAMES[b]}${m ? ": " + m.name : ""}${on ? "" : " (off)"}${crossed ? ", replaced by the SnapTone" : ""}`;
    return `<button class="blk b${b} ${on ? "on" : ""} ${crossed ? "crossed" : ""} ${ui.block === b ? "sel" : ""}" data-block="${b}" role="listitem" title="${esc(tip)}" aria-label="${esc(tip)}">
      ${icon(BLOCK_ICON[b], 20)}<span class="k">${BLOCK_SHORT[b]}</span></button>`;
  }).join("")}</div>`;
}

// ------------------------------------------------------------------ a setting (fader)
// Name and value on one line, the slider under it. The value is a button: click or double-click it (or double-click
// the slider, or press Enter on either) to type an exact value; Enter or leaving the field sets it, Esc cancels.
// p: { min, max, step, unit } (a catalog parameter, or VOLUME); the value is snapped as the pedal does.
const VOLUME = { name: "Volume", min: 0, max: 100, step: 1, unit: "", def: 50 };
const num = (p, v) => formatValue({ ...p, unit: "" }, v);
const fill = (p, v) => (p.max > p.min ? Math.min(100, Math.max(0, ((v - p.min) / (p.max - p.min)) * 100)) : 0).toFixed(1) + "%";
function fader(ctx, key, name, p, v) {
  const { esc } = ctx, out = v < p.min || v > p.max;
  const tip = out ? "Outside the model's range; it changes when you move it" : `${num(p, p.min)} to ${num(p, p.max)}${p.unit ? " " + p.unit : ""}. Click to type a value`;
  return `<div class="fader" style="--fill:${fill(p, v)}" data-fader="${key}">
    <div class="fader-top"><span class="fader-name" id="fn-${key}">${esc(name)}</span>
      <button type="button" class="pv ${out ? "warnv" : ""}" data-pv title="${esc(tip)}" aria-label="${esc(name)} ${esc(formatValue(p, v))}, type a value">${esc(num(p, v))}${p.unit ? `<span class="u">${esc(p.unit)}</span>` : ""}</button></div>
    <input type="range" class="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" aria-labelledby="fn-${key}" aria-valuetext="${esc(formatValue(p, v))}">
  </div>`;
}

// specs: key -> { p, get(), set(v, final) }; set(v, false) while dragging, set(v, true) when let go or typed (redraws)
function mountFaders(root, specs) {
  root.querySelectorAll("[data-fader]").forEach((el) => {
    const key = el.dataset.fader, s = specs[key]; if (!s) return;
    const { p } = s, r = el.querySelector("input.range"), pv = el.querySelector("[data-pv]");
    const show = (v) => {
      pv.innerHTML = ""; pv.append(num(p, v));
      if (p.unit) { const u = document.createElement("span"); u.className = "u"; u.textContent = p.unit; pv.append(u); }
      pv.classList.remove("warnv"); el.style.setProperty("--fill", fill(p, v)); r.setAttribute("aria-valuetext", formatValue(p, v));
    };
    r.addEventListener("input", () => { const v = snap(p, +r.value); show(v); s.set(v, false); });
    r.addEventListener("change", () => s.set(snap(p, +r.value), true));
    const edit = () => {
      if (el.querySelector(".pv-edit")) return;
      const inp = document.createElement("input");
      Object.assign(inp, { type: "text", className: "pv-edit", inputMode: "decimal", value: num(p, s.get()), spellcheck: false });
      inp.setAttribute("aria-label", `${el.querySelector(".fader-name").textContent}, ${num(p, p.min)} to ${num(p, p.max)}${p.unit ? " " + p.unit : ""}`);
      pv.hidden = true; pv.after(inp); inp.focus(); inp.select();
      let done = false;
      const finish = (keep, refocus) => {
        if (done) return; done = true;
        const m = String(inp.value).replace(",", ".").match(/-?\d*\.?\d+/);
        if (keep && m) {
          const v = snap(p, parseFloat(m[0]));
          if (v !== s.get()) { s.set(v, true); if (refocus) document.querySelector(`[data-fader="${key}"] [data-pv]`)?.focus(); return; }
        }
        inp.remove(); pv.hidden = false; if (refocus) pv.focus();
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false, true); }
      });
      inp.addEventListener("blur", () => finish(true, false));
    };
    pv.addEventListener("click", edit);
    r.addEventListener("dblclick", edit);
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); edit(); } });
  });
}

function blockPanel(ctx) {
  const { esc, icon } = ctx, d = ui.draft, b = ui.block, cat = catalog();
  if (b === null) return `<p class="muted">Pick a block in the chain to change its model and settings.</p>`;
  const on = !!(d.mask & (1 << b)), pos = d.order.indexOf(b);
  const head = `<div class="row" style="justify-content:space-between;margin-bottom:12px">
      <div class="row"><b style="font-size:15px">${esc(BLOCK_NAMES[b])}</b>
        <label class="row" style="gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" class="switch" role="switch" data-on ${on ? "checked" : ""}> ${on ? "on" : "off"}</label></div>
      <div class="row" style="gap:2px">
        <button class="btn small ghost icon-only" data-shift="-1" ${pos === 0 ? "disabled" : ""} aria-label="Move earlier in the chain" title="Move earlier in the chain">${icon("arrow-left", 15)}</button>
        <button class="btn small ghost icon-only" data-shift="1" ${pos === 9 ? "disabled" : ""} aria-label="Move later in the chain" title="Move later in the chain">${icon("arrow-right", 15)}</button></div></div>`;
  if (!cat) return head + `<p class="muted">Model and setting names aren't loaded yet: use “Get the names” above.</p>`;
  const m = modelFor(cat, b, d.models[b]);
  const groups = new Map();
  for (const x of cat.blocks[b].models) { if (!groups.has(x.category)) groups.set(x.category, []); groups.get(x.category).push(x); }
  const select = `<label class="field" style="margin-bottom:14px">Model
      <select data-model>${m.unknown ? `<option value="${d.models[b]}" selected>${esc(m.name)}</option>` : ""}
      ${[...groups].map(([g, xs]) => `<optgroup label="${esc(g)}">${xs.map((x) => `<option value="${x.id}" ${x.id === d.models[b] ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>`).join("")}
      </select></label>`;
  const params = m.params.map((p) => {
    const v = d.params[b][p.slot];
    if (p.toggle) return `<label class="fader toggle"><span class="fader-name">${esc(p.name)}</span><input type="checkbox" class="switch" role="switch" data-p="${p.slot}" ${v ? "checked" : ""}></label>`;
    return fader(ctx, `p${p.slot}`, p.name, p, v);
  }).join("");
  return head + select + (params ? `<div class="params">${params}</div>` : '<p class="muted">This model has no settings.</p>');
}

function editor(ctx) {
  const { esc, icon, state } = ctx, d = ui.draft, st = state.stock;
  if (!d) return `<section class="card w-stock"><div class="card-head"><h2>${icon("adjustments-horizontal", 18)} Editor</h2></div>
      <p class="muted">Pick a preset on the left.</p>${catalogNote(ctx)}</section>`;
  const live = ui.live && st.current === ui.sel;
  return `<section class="card w-stock">
    <div class="card-head"><h2><span class="mono" style="color:var(--world)">${two(ui.sel)}</span>
        <input type="text" data-name value="${esc(d.name)}" maxlength="10" aria-label="Preset name" style="width:180px;font-weight:700"></h2>
      <div class="row" style="gap:4px">
        <button class="btn small ghost icon-only" data-act="export" aria-label="Export to a file" title="Export to a file">${icon("file-export", 15)}</button>
        <button class="btn small ghost icon-only" data-act="import" aria-label="Load from a file" title="Load from a file">${icon("file-import", 15)}</button>
        <button class="btn small ghost icon-only danger" data-act="factory" aria-label="Reset to factory" title="${ui.sel < S.FACTORY ? "Back to Valeton's factory preset" : "Back to a blank preset"}">${icon("restore", 15)}</button></div></div>
    ${catalogNote(ctx)}
    <div class="row" style="justify-content:space-between;margin:2px 0 10px">
      <label class="row" style="gap:8px;font-size:13px" title="Changes go to the pedal right away. Save stores them.">
        <input type="checkbox" data-live ${ui.live ? "checked" : ""} ${catalog() ? "" : "disabled"}> Hear it live${live ? ' <span class="pill world">live</span>' : ""}</label>
      <div style="width:min(300px,100%)">${fader(ctx, "vol", "Preset volume", VOLUME, d.volume)}</div></div>
    ${chain(ctx)}
    <div class="blockpanel tone ${ui.block !== null ? "b" + ui.block : ""}">${blockPanel(ctx)}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn" data-act="revert" ${dirty() ? "" : "hidden"}>Undo changes</button>
      <button class="btn primary" data-act="save" ${dirty() && !state.busy && st.version === S.V106 ? "" : "disabled"}>${icon("device-floppy", 16)} Save to pedal</button></div>
  </section>`;
}

function catalogNote(ctx) {
  const { icon, esc } = ctx, cat = catalog();
  if (cat) return "";
  return `<div class="note" style="margin:6px 0 12px">${icon("info-circle", 16)}<span>To show models and settings by name, Launchpad reads them once from
    Valeton's firmware V1.0.6 (downloaded from Valeton's website, or a file you have).
    <button class="btn small" data-act="catalog" style="margin-top:8px">${icon("download", 15)} Get the names</button>${ui.catError ? `<br><span style="color:var(--bad)">${esc(ui.catError)}</span>` : ""}</span></div>`;
}

function cleanCard(ctx) {
  const { icon, esc, state } = ctx, b = ui.banks, busy = !!state.busy || !!ui.wipe;
  const used = (k) => (b?.[k] ? b[k].filter((x) => x.used).length : null);
  const st = state.stock, v106 = st?.version === S.V106;
  const open = ui.cleanOpen || !!ui.wipe;
  const head = `<div class="card-head" style="${open ? "" : "margin-bottom:0"}"><h2>${icon("trash", 18)} Clean up the pedal</h2>
      <button class="btn small" data-act="clean" aria-expanded="${open}" aria-controls="cleanbody">${open ? "Close" : "Show"}</button></div>`;
  if (!open) return `<section class="card w-stock" style="margin-top:var(--gap)">${head}
    <p class="faint" style="font-size:13px;margin-top:6px">Clear all presets, SnapTones or user IRs at once.</p></section>`;
  return `<section class="card w-stock" style="margin-top:var(--gap)">${head}<div id="cleanbody">
    <p class="muted" style="margin-bottom:12px">Presets can be restored from a backup. SnapTones and IRs can't, so keep your original files.</p>
    ${ui.wipe ? `<div style="margin-bottom:10px"><p class="muted" style="font-size:12.5px;margin-bottom:6px">${esc(ui.wipe.label)}</p><progress max="1" value="${ui.wipe.f}"></progress></div>` : ""}
    <div class="list">
      <div class="item tall"><span class="main"><span class="name">All 100 presets</span><span class="sub">Each becomes a blank “GP-5” preset, 00–49 included</span></span>
        <button class="btn small danger" data-wipe="presets" ${busy || !v106 ? "disabled" : ""}>${icon("trash", 15)} Clear presets</button></div>
      <div class="item tall"><span class="main"><span class="name">SnapTones</span><span class="sub">${used("snaptone") === null ? "reading…" : `${used("snaptone")} of 80 slots in use`}</span></span>
        <button class="btn small danger" data-wipe="snaptone" ${busy || !v106 || !used("snaptone") ? "disabled" : ""}>${icon("trash", 15)} Delete all SnapTones</button></div>
      <div class="item tall"><span class="main"><span class="name">User IRs</span><span class="sub">${used("ir") === null ? "reading…" : `${used("ir")} of 20 slots in use`} · the built-in cabs stay</span></span>
        <button class="btn small danger" data-wipe="ir" ${busy || !v106 || !used("ir") ? "disabled" : ""}>${icon("trash", 15)} Delete all user IRs</button></div>
    </div></div></section>`;
}

export function renderStock(ctx) {
  const { state, icon, esc } = ctx, st = state.stock;
  if (state.pedalSerial !== ui.serial) { ui.serial = state.pedalSerial; ui.sel = ui.base = ui.draft = null; ui.block = null; ui.live = false; ui.result = null; }
  const head = ctx.banner("w-stock", "adjustments-horizontal", "Valeton presets", "",
    { chips: st?.list ? [`${st.list.filter((p) => !S.isBlank(p.name)).length} of 100 in use`, catalog() ? `${catalog().count} models` : "models: not loaded"] : [],
      actions: `<button class="btn" data-go="backups">${icon("archive", 16)} Back up all</button>` });
  if (!st) return head + `<p class="muted">Reading the pedal…</p>`;
  if (st.error) return head + `<div class="note bad">${icon("alert-triangle", 16)}<span>${esc(st.error)}</span></div>`;
  const warn = st.version !== S.V106 ? `<div class="note warn" style="margin-bottom:var(--gap)">${icon("alert-triangle", 16)}<span>This pedal runs a Valeton firmware other than V1.0.6 (${hex(st.version)}). Launchpad's preset editor is made for V1.0.6: reading works, saving is switched off.</span></div>` : "";
  return head + warn +
    (ui.result ? `<div class="note ${ui.result.ok ? "good" : "bad"}" style="margin-bottom:var(--gap)">${icon(ui.result.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(ui.result.text)}</span></div>` : "") +
    `<div class="stockgrid">${listCard(ctx)}${editor(ctx)}</div>` + cleanCard(ctx);
}

// ------------------------------------------------------------------ doing

async function open(ctx, n) {
  const hadFocus = document.activeElement?.dataset?.sel !== undefined;
  if (dirty() && !(await ctx.confirm("Leave your changes?", `Preset ${two(ui.sel)} has changes that aren't saved on the pedal.`, "Leave them", true))) return;
  ui.result = null;
  try {
    const p = await ctx.withLink("Reading the preset", (link) => S.readPreset(link, n));
    ui.sel = n; ui.base = p; ui.draft = clone(p);
    ui.block = ui.block ?? 3;
    if (ui.live) await goLive(ctx);
  } catch (e) { ui.result = { ok: false, text: e.message }; }
  ctx.render();
  if (hadFocus) document.querySelector(`[data-sel="${n}"]`)?.focus({ preventScroll: true });
}

// Make the pedal play the selected preset so changes can be heard. Its unsaved edits on the pedal are lost.
async function goLive(ctx) {
  const n = ui.sel;
  const ok = await ctx.withLink("Switching the pedal", async (link) => {
    if (await S.currentPreset(link) === n && !(await S.hasUnsavedEdits(link))) return true;
    if (await S.hasUnsavedEdits(link)) {
      const go = await ctx.confirm("Switch the pedal to this preset?", "The pedal has changes on its current preset that aren't saved. Switching loses them.", "Switch", true);
      if (!go) return false;
    }
    await S.live.select(link, n);
    if (!S.samePreset(ui.draft, ui.base)) await pushAll(link);
    ctx.state.stock.current = n;
    return true;
  });
  if (!ok) ui.live = false;
}

// Send the whole draft to the pedal's edit buffer (after switching to it, loading a file, undoing). Models first
// (a model change loads its defaults there), then only the parameters the catalog lists: the pedal maps an
// unknown parameter ID to the model's first setting (FUN_1622c returns 0), so hidden slots are never sent.
async function pushAll(link) {
  const d = ui.draft, cat = catalog();
  for (let b = 0; b < 10; b++) await S.live.model(link, b, d.models[b]);
  for (let b = 0; b < 10; b++) await S.live.on(link, b, (d.mask >> b) & 1);
  await S.live.order(link, d.order);
  await S.live.volume(link, d.volume);
  for (let b = 0; b < 10; b++) for (const p of modelFor(cat, b, d.models[b]).params) await S.live.param(link, b, p.slot, d.params[b][p.slot]);
}

// One change to the pedal's edit buffer, when live. Quiet: no busy screen (sliders keep their focus).
let pending = Promise.resolve();
function sendLive(ctx, fn) {
  if (!ui.live || !catalog() || ctx.state.stock?.current !== ui.sel) return;
  pending = pending.then(() => ctx.linkQuiet(fn)).catch((e) => { ui.result = { ok: false, text: "Live: " + e.message }; ui.live = false; ctx.render(); });
}
let throttle = null;
function sendParamSoon(ctx, b, k, v) {
  clearTimeout(throttle);
  throttle = setTimeout(() => sendLive(ctx, (link) => S.live.param(link, b, k, v)), 60);
}

function setModel(b, id) {
  const d = ui.draft, m = modelFor(catalog(), b, id);
  d.models[b] = id;
  for (const p of m.params) d.params[b][p.slot] = p.def;   // as the pedal does: the model's defaults, hidden slots kept
}

let triedSaved = false;
const WIPE = {
  presets: { title: "Clear all 100 presets?", text: "All 100 presets become blank “GP-5” presets, the factory ones included. Takes about a minute.\n\nBack up first to keep any of them.", ok: "Clear presets" },
  snaptone: { title: "Delete all SnapTones?", text: "All SnapTones on the pedal are deleted. This can't be undone, and Launchpad can't back them up.", ok: "Delete SnapTones", check: "I have my original SnapTone files, or don't need them" },
  ir: { title: "Delete all user IRs?", text: "All user IRs are deleted; the built-in cabs stay. This can't be undone, and Launchpad can't back them up.", ok: "Delete IRs", check: "I have my original IR files, or don't need them" },
};
export function mountStock(root, ctx) {
  const { state } = ctx, d = ui.draft;
  if (state.stock?.list && ui.banksFor !== state.pedalSerial && !state.busy) {      // read the SnapTone / IR lists once
    ui.banksFor = state.pedalSerial;
    ctx.withLink("Reading SnapTones", async (link) => ({ snaptone: await S.listBank(link, "snaptone"), ir: await S.listBank(link, "ir") }))
      .then((b) => { ui.banks = b; ctx.render(); }).catch((e) => { ui.banksFor = null; ui.result = { ok: false, text: e.message }; ctx.render(); });
  }
  root.querySelectorAll("[data-wipe]").forEach((btn) => btn.onclick = async () => {
    const what = btn.dataset.wipe, w = WIPE[what];
    if (what === "presets") {
      const a = await ctx.choose(w.title, w.text, [{ value: "cancel", label: "Cancel" }, { value: "backup", label: "Back up first", primary: true }, { value: "go", label: w.ok, danger: true }]);
      if (a === "backup") return ctx.go("backups");
      if (a !== "go") return;
    } else if (!(await ctx.confirm(w.title, w.text, w.ok, true, { check: w.check }))) return;
    ui.result = null; ui.wipe = { label: "Starting", f: 0 }; ctx.render();
    const step = (label) => (n, total) => { ui.wipe = { label: `${label} ${n} of ${total}`, f: n / total }; const p = document.querySelector(".card progress"); if (p) { p.value = n / total; p.previousElementSibling.textContent = ui.wipe.label; } };
    try {
      const text = await ctx.withLink(what === "presets" ? "Clearing presets" : "Deleting", async (link) => {
        if (what === "presets") {
          await S.clearAllPresets(link, step("Clearing preset"));
          await ctx.loadStock(link);
          return "All 100 presets are blank.";
        }
        const r = await S.clearBank(link, what, step(`Deleting ${S.BANKS[what].title}`));
        ui.banks = { ...ui.banks, [what]: await S.listBank(link, what) };
        if (r.left) throw new Error(`${r.deleted} deleted, but ${r.left} ${S.BANKS[what].title} slot${r.left === 1 ? " is" : "s are"} still in use. Try again.`);
        return `Deleted ${r.deleted} ${S.BANKS[what].title}${r.deleted === 1 ? "" : "s"}.`;
      });
      ui.sel = ui.base = ui.draft = null;
      ui.result = { ok: true, text };
    } catch (e) { ui.result = { ok: false, text: e.message }; }
    ui.wipe = null; ctx.render();
  });
  if (!catalog() && !triedSaved) {                          // a saved copy of Valeton's firmware: read the names from it
    triedSaved = true;
    ctx.stockImage({ quiet: true }).then((f) => { if (f) { const cat = catalogFromImage(f.bytes); saveCatalog(cat, f.name); ui.cat = cat; ctx.render(); } }).catch(() => {});
  }
  root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => ctx.go(b.dataset.go));
  const list = root.querySelector("[data-list]");             // keep the list where the user scrolled it
  if (list) { list.scrollTop = ui.listTop || 0; list.addEventListener("scroll", () => { ui.listTop = list.scrollTop; }, { passive: true }); }
  root.querySelector("[data-filter]")?.addEventListener("input", (e) => {
    ui.filter = e.target.value; ui.listTop = 0; const pos = e.target.selectionStart; ctx.render();
    const f = document.querySelector("[data-filter]"); if (f) { f.focus(); f.setSelectionRange(pos, pos); }
  });
  root.querySelectorAll("[data-sel]").forEach((el) => {
    const go = () => open(ctx, +el.dataset.sel);
    el.onclick = go;
    el.onkeydown = (e) => {
      // one tab stop for the whole list (roving tabindex): arrows, Home and End move, Enter or Space opens
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); return; }
      const all = [...el.parentElement.querySelectorAll("[data-sel]")], i = all.indexOf(el);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const t = all[Math.max(0, Math.min(all.length - 1, to))];
      el.tabIndex = -1; t.tabIndex = 0; t.focus();
    };
  });
  root.querySelector('[data-act="reload"]')?.addEventListener("click", () => ctx.reloadStock());
  root.querySelector('[data-act="clean"]')?.addEventListener("click", () => {
    ui.cleanOpen = !ui.cleanOpen; ctx.render(); document.querySelector('[data-act="clean"]')?.focus();
  });
  root.querySelector('[data-act="catalog"]')?.addEventListener("click", async () => {
    const f = await ctx.stockImage({ why: "Launchpad reads the model and setting names from it." });
    if (!f) return;
    try { const cat = catalogFromImage(f.bytes); saveCatalog(cat, f.name); ui.cat = cat; ui.catError = null; ctx.toast(`${cat.count} models read from ${f.name}`); }
    catch (e) { ui.catError = e.message; }
    ctx.render();
  });
  if (!d) return;
  const n = ui.sel, rerender = () => { ui.result = null; ctx.render(); };
  root.querySelector("[data-name]")?.addEventListener("input", (e) => {
    const v = S.cleanName(e.target.value); if (v !== e.target.value) e.target.value = v;
    d.name = v; root.querySelector('[data-act="save"]').disabled = !dirty() || !!state.busy; root.querySelector('[data-act="revert"]').hidden = !dirty();
  });
  root.querySelectorAll("[data-block]").forEach((el) => el.onclick = () => { ui.block = +el.dataset.block; ctx.render(); });
  const b = ui.block, m = catalog() ? modelFor(catalog(), b, d.models[b]) : null;
  const specs = { vol: { p: VOLUME, get: () => d.volume, set: (v, final) => { d.volume = v; if (final) { sendLive(ctx, (link) => S.live.volume(link, v)); rerender(); } } } };
  for (const p of m?.params || []) if (!p.toggle) specs[`p${p.slot}`] = { p, get: () => d.params[b][p.slot], set: (v, final) => { d.params[b][p.slot] = v; sendParamSoon(ctx, b, p.slot, v); if (final) rerender(); } };
  mountFaders(root, specs);
  root.querySelector("[data-on]")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    d.mask = on ? d.mask | (1 << b) : d.mask & ~(1 << b);
    // SnapTone and amp + cab don't run together (as on the pedal): switching one side on switches the other off
    const rivals = !on ? [] : b === SNAP ? [AMP, CAB] : b === AMP || b === CAB ? [SNAP] : [];
    const off = rivals.filter((x) => d.mask & (1 << x));
    for (const x of off) d.mask &= ~(1 << x);
    sendLive(ctx, async (link) => { for (const x of off) await S.live.on(link, x, false); await S.live.on(link, b, on); });
    rerender();
  });
  root.querySelectorAll("[data-shift]").forEach((el) => el.onclick = () => {
    const i = d.order.indexOf(b), j = i + +el.dataset.shift;
    [d.order[i], d.order[j]] = [d.order[j], d.order[i]];
    const order = [...d.order];
    sendLive(ctx, (link) => S.live.order(link, order)); rerender();
  });
  root.querySelector("[data-model]")?.addEventListener("change", (e) => {
    const id = Number(e.target.value) >>> 0;
    setModel(b, id);
    sendLive(ctx, (link) => S.live.model(link, b, id));       // the pedal loads the same defaults itself
    rerender();
  });
  root.querySelectorAll("input.switch[data-p]").forEach((el) => {
    const k = +el.dataset.p;
    el.onchange = () => { d.params[b][k] = el.checked ? 1 : 0; sendLive(ctx, (link) => S.live.param(link, b, k, d.params[b][k])); rerender(); };
  });
  root.querySelector("[data-live]")?.addEventListener("change", async (e) => {
    ui.live = e.target.checked; ui.result = null;
    if (ui.live) { try { await goLive(ctx); } catch (err) { ui.live = false; ui.result = { ok: false, text: err.message }; } }
    ctx.render();
  });
  root.querySelector('[data-act="revert"]')?.addEventListener("click", () => {
    ui.draft = clone(ui.base);
    sendLive(ctx, (link) => pushAll(link));
    rerender();
  });
  root.querySelector('[data-act="save"]')?.addEventListener("click", async () => {
    if (state.stock.version !== S.V106) { ui.result = { ok: false, text: "Saving is only switched on for Valeton's firmware V1.0.6." }; return ctx.render(); }
    if (!(await ctx.confirm(`Save preset ${two(n)} on the pedal?`, `“${ui.base.name}” on the pedal is replaced by “${d.name}”.`, "Save"))) return;
    try {
      await pending;
      const back = await ctx.withLink("Saving the preset", async (link) => {
        const now = await S.readPreset(link, n);
        if (!S.samePreset(now, ui.base)) throw Object.assign(new Error(`Preset ${two(n)} changed on the pedal since you opened it (saved on the pedal?). Nothing was written. Open it again to start from what's there now.`), { changed: now });
        const r = await S.writePreset(link, n, d);
        await ctx.loadStock(link);
        return r;
      });
      ui.base = back; ui.draft = clone(back);
      ui.result = { ok: true, text: `Saved preset ${two(n)} “${back.name}” .` };
    } catch (e) { ui.result = { ok: false, text: e.message }; }
    ctx.render();
  });
  root.querySelector('[data-act="factory"]')?.addEventListener("click", async () => {
    const what = n < S.FACTORY ? "Valeton's factory preset" : "a blank preset (“GP-5”)";
    if (!(await ctx.confirm(`Reset preset ${two(n)}?`, `Preset ${two(n)} on the pedal goes back to ${what}. Its current settings are lost unless you exported or backed them up.`, "Reset", true))) return;
    try {
      const back = await ctx.withLink("Resetting the preset", async (link) => { const r = await S.resetPreset(link, n); await ctx.loadStock(link); return r; });
      ui.base = back; ui.draft = clone(back); ui.result = { ok: true, text: `Preset ${two(n)} is ${what} again.` };
    } catch (e) { ui.result = { ok: false, text: e.message }; }
    ctx.render();
  });
  root.querySelector('[data-act="export"]')?.addEventListener("click", async () => {
    const saved = await ctx.saveFile("Export preset", `${two(n)} ${d.name || "preset"}.gp5preset`.replace(/[\\/:*?"<>|]/g, ""), [{ name: "GP-5 preset", extensions: ["gp5preset"] }], S.presetFile(d));
    if (saved) ctx.toast(`Saved ${saved.name}`);
  });
  root.querySelector('[data-act="import"]')?.addEventListener("click", async () => {
    const f = await ctx.openFile("Load a GP-5 preset", [{ name: "GP-5 preset", extensions: ["gp5preset"] }]);
    if (!f) return;
    try {
      ui.draft = S.readPresetFile(f.bytes);
      if (ui.live) sendLive(ctx, (link) => pushAll(link));
      ui.result = { ok: true, text: `Loaded “${ui.draft.name}” into preset ${two(n)}. Save to put it on the pedal.` };
    } catch (e) { ui.result = { ok: false, text: e.message }; }
    ctx.render();
  });
}
