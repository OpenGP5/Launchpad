// Tones for NAM Loader 1.3 and later. Left: one list, every slot, NAM captures or IRs (a toggle swaps them); the list
// scrolls inside its card, which fills the window's height. Right, the same height: adding at the top (into the empty
// slot picked, or the first free one), then the details of the one picked: play it on the pedal (1.3.1), rename,
// replace, remove, its IR, and its gate and EQ (folded at the bottom). Settings of the capture playing go live
// (parameters); of any other, into the firmware's settings record (namfiles.js setToneEntry). Drop a .nam or a .wav
// anywhere on the page to add it. Earlier NAM Loaders keep the older page (tones.js).
import { convertNam, NotA2 } from "../lib/gp5nam.js";
import { putToneFile, emptyToneFile, putCabFile, removeCabFile, shrinkCabs, setToneEntry, toneEntry, playSlot, renameCapture,
         renameCab, NAM_P, IRS } from "../lib/namfiles.js";
import { decodeIr, makeCabFile, CAB_TAPS, CAB_RATE } from "../lib/cabir.js";
import { paramSet, paramsRead } from "../lib/device.js";
import { TONE_KNOBS } from "./namtone.js";

const two = (i) => String(i + 1).padStart(2, "0");
const ms = (n) => `${Math.round((n / CAB_RATE) * 1000)} ms`;
const stem = (f) => f.replace(/\.nam$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
const irStem = (f) => f.replace(/\.(wav|wave)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
const db = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)} dB`;
const PREFS = { calibrate: "nam-calibrate", level: "nam-level" };
function pref(k) { try { return localStorage.getItem(PREFS[k]) !== "off"; } catch { return true; } }
function setPref(k, on) { try { localStorage.setItem(PREFS[k], on ? "on" : "off"); } catch { /* this session only */ } }
const opts = () => ({ calibrate: pref("calibrate"), level: pref("level") });
function levels(c) {                                   // what the two switches did to this capture
  const o = opts(), a = [];
  if (o.calibrate) a.push(c.calibrated ? `input ${db(c.gainDb)}` : "input unchanged (no recording level in the file)");
  if (o.level) a.push(`normalized ${db(c.levelDb)}`);
  return a.join(" · ");
}

// tab: "caps" | "irs" (the toggle); sel / irSel: the slot picked (filled or empty); cap / ir: a file to add;
// mode: null | "rename"; vals: the knobs of the capture shown; live: the pedal's last answer
const B = { tab: "caps", sel: null, irSel: null, cap: null, capErr: null, ir: null, irErr: null, mode: null, result: null,
            addResult: null, progress: null, converting: false, vals: null, valsFor: null, live: null, timer: null, ctx: null,
            drag: -1, sending: false, queue: new Map(), local: [0, 0, 0, 0], saveTimer: null, convOpen: false, eqOpen: false };

const firstFree = (list) => list.findIndex((s) => !s);
function pick(nam) {                                   // keep the picks valid
  const bank = nam.bank, cabs = nam.cabs || [];
  if (B.sel === null || B.sel >= bank.length) {
    const playing = bank.findIndex((s) => s && s.crc === nam.playing);
    B.sel = playing >= 0 ? playing : Math.max(0, bank.findIndex(Boolean));
  }
  if (B.irSel === null || B.irSel >= IRS) B.irSel = Math.max(0, cabs.findIndex(Boolean));
}
const addTarget = (list, sel) => (!list[sel] ? sel : firstFree(list));   // the empty slot picked, else the first free

export function renderBank(ctx) {
  const { state, icon } = ctx, nam = state.nam, bank = nam.bank, cabs = nam.cabs || [];
  pick(nam);
  const used = bank.filter(Boolean).length, irsUsed = cabs.filter(Boolean).length;
  const head = ctx.banner("w-nam", "wave-sine", "Tones", "", {
    chips: [`${used} of ${bank.length} captures`, `${irsUsed} of ${IRS} IRs`, ...(nam.free !== undefined ? [`${nam.free * 4} KB free`] : [])],
  });
  const legacy = nam.legacy?.length ? `<div class="note warn" style="margin-bottom:var(--gap)">${icon("info-circle", 16)}<span>${nam.legacy.length} capture${nam.legacy.length === 1 ? " is" : "s are"} in the old storage. Send ${nam.legacy.length === 1 ? "it" : "them"} again to keep ${nam.legacy.length === 1 ? "it" : "them"}.</span></div>` : "";
  const caps = B.tab === "caps";
  const sw = (id, label, n, max) => `<button type="button" role="tab" aria-selected="${B.tab === id}" aria-controls="tb-list" tabindex="${B.tab === id ? 0 : -1}"
      data-tab="${id}">${label} <span class="tb-count">${n}/${max}</span></button>`;
  return head + legacy + `<div class="tb-grid w-nam" id="tb-panel">
    <section class="card tb-left">
      <div class="tb-toggle" role="tablist" aria-label="Show">${sw("caps", "NAM", used, bank.length)}${sw("irs", "IR", irsUsed, IRS)}</div>
      ${caps ? capsList(ctx) : irsList(ctx)}
    </section>
    <div class="tb-right">
      <section class="card tb-addcard">${caps ? addCap(ctx) : addIr(ctx)}</section>
      <section class="card tb-detail" aria-live="polite">${caps ? capDetail(ctx) : irDetail(ctx)}</section>
    </div>
    <div class="tb-dropcover" hidden>${icon("upload", 28)}<span>Drop to add</span></div></div>`;
}

// ---------------------------------------------------------------- the list (every slot)

function capsList(ctx) {
  const { state, esc, icon } = ctx, nam = state.nam, bank = nam.bank, cabs = nam.cabs || [];
  const rows = bank.map((s, i) => {
    const sel = B.sel === i, playing = s && s.crc === nam.playing;
    if (!s) return `<div class="item pick tb-empty ${sel ? "sel" : ""}" role="option" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-slot="${i}"
        aria-label="Slot ${two(i)}: empty"><span class="n">${two(i)}</span><span class="main"><span class="name empty">empty</span></span></div>`;
    const ir = nam.irs?.[i] ?? -1, irName = ir >= 0 ? (cabs[ir]?.name || `IR ${two(ir)}`) : "";
    const label = `Slot ${two(i)}: ${s.name || "no name"}${ir >= 0 ? `, plays ${irName}` : ""}${playing ? ", playing" : ""}`;
    return `<div class="item pick tall ${sel ? "sel" : ""}" role="option" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-slot="${i}"
        title="${esc(s.name)}" aria-label="${esc(label)}"><span class="n">${two(i)}</span>
      <span class="main"><span class="name">${esc(s.name || "(no name)")}</span>${ir >= 0 ? `<span class="sub tb-ir">${icon("device-speaker", 12)} ${esc(irName)}</span>` : ""}</span>
      ${playing ? `<span class="pill world" title="Playing on the pedal">${icon("player-play", 12)} playing</span>` : ""}</div>`;
  }).join("");
  return `<div class="list tb-scroll" id="tb-list" role="listbox" aria-label="NAM captures on the pedal">${rows}</div>`;
}

function irsList(ctx) {
  const { state, esc } = ctx, nam = state.nam, cabs = nam.cabs || [], irs = nam.irs || [];
  const old = cabs.filter((c) => c?.format === 1).length;
  const rows = cabs.map((c, k) => {
    const sel = B.irSel === k;
    if (!c) return `<div class="item pick tb-empty ${sel ? "sel" : ""}" role="option" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-ir="${k}"
        aria-label="IR ${two(k)}: empty"><span class="n">${two(k)}</span><span class="main"><span class="name empty">empty</span></span></div>`;
    const u = irs.filter((x) => x === k).length;
    return `<div class="item pick tall ${sel ? "sel" : ""}" role="option" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-ir="${k}" title="${esc(c.name || "")}"
      aria-label="${esc(`IR ${two(k)}: ${c.name || "no name"}${u ? `, played by ${u} capture${u === 1 ? "" : "s"}` : ""}`)}">
      <span class="n">${two(k)}</span><span class="main"><span class="name">${esc(c.name || "(no name)")}</span>
      ${u ? `<span class="sub">${u} capture${u === 1 ? "" : "s"}</span>` : ""}</span>
      ${c.format === 1 ? '<span class="pill" title="The older format, twice the size">old</span>' : ""}</div>`;
  }).join("");
  return `${old ? `<div class="note warn tb-oldnote"><span style="flex:1">${old} IR${old === 1 ? " uses" : "s use"} the older format, twice the size.</span>
      <button class="btn small" data-act="shrink" ${state.busy ? "disabled" : ""}>Shrink</button></div>` : ""}
    <div class="list tb-scroll" id="tb-list" role="listbox" aria-label="IRs on the pedal">${rows}</div>`;
}

// ---------------------------------------------------------------- adding (top right)

function dropZone(ctx, id, file, what, label) {
  const { esc, icon } = ctx;
  return `<div class="drop" id="${id}">${icon("file-music", 26)}<div style="flex:1;min-width:0">${file
      ? `<b class="tb-file">${esc(file)}</b><span style="color:var(--good);font-size:13px">${what}</span>`
      : label}</div><button class="btn small" data-pickfile="${id}">${file ? "Another" : "Choose file"}</button></div>`;
}
function result(ctx, r) {
  const { esc, icon } = ctx;
  return r ? `<div class="note ${r.ok ? "good" : "bad"}">${icon(r.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(r.text)}</span></div>` : "";
}

function addCap(ctx) {
  const { state, esc, icon } = ctx, bank = state.nam.bank, to = addTarget(bank, B.sel), c = B.cap;
  if (to < 0) return `<h2>Add a capture</h2><p class="muted" style="margin:8px 0 0">All ${bank.length} slots are full. Remove one to make room.</p>`;
  const conv = [pref("calibrate") ? "calibrated" : null, pref("level") ? "normalized" : null].filter(Boolean).join(", ") || "as recorded";
  return `<div class="card-head" style="margin-bottom:12px"><h2>${icon("upload", 18)} Add a capture</h2><span class="faint mono">slot ${two(to)}</span></div>
    <div class="stack" style="gap:12px">
    ${dropZone(ctx, "namdrop", B.converting ? null : c?.file, c ? `Ready${levels(c) ? ` · ${esc(levels(c))}` : ""}` : "",
               B.converting ? "Converting…" : "Drop a .nam file here")}
    ${B.capErr ? `<div class="note bad">${icon("alert-triangle", 16)}<span>${esc(B.capErr)}</span></div>` : ""}
    ${c ? `<label class="field">Name on the pedal<input type="text" id="capname" maxlength="24" value="${esc(c.name)}" spellcheck="false"></label>` : ""}
    <details class="tb-fold" data-fold="conv" ${B.convOpen ? "open" : ""}><summary>Conversion <span class="faint">${conv}</span></summary>
      <div class="stack" style="gap:10px;margin-top:10px">
        <label class="row between" style="flex-wrap:nowrap;gap:12px"><span style="min-width:0"><b style="font-weight:600">Calibrate</b><span class="faint" style="display:block;font-size:12.5px">Matches the pedal's input to the level the capture was recorded at, so it reacts to your playing like the original gear. Only for files that include their recording level.</span></span>
          <input type="checkbox" class="switch" role="switch" data-pref="calibrate" ${pref("calibrate") ? "checked" : ""}></label>
        <label class="row between" style="flex-wrap:nowrap;gap:12px"><span style="min-width:0"><b style="font-weight:600">Normalize</b><span class="faint" style="display:block;font-size:12.5px">Sets every capture to the same volume. Off: each one is as loud as the gear it captured.</span></span>
          <input type="checkbox" class="switch" role="switch" data-pref="level" ${pref("level") ? "checked" : ""}></label></div></details>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="sendcap" data-to="${to}" ${c && !state.busy ? "" : "disabled"}>${icon("upload", 16)} Send to slot ${two(to)}</button></div>
    ${B.progress !== null ? `<progress max="1" value="${B.progress}"></progress>` : ""}
    ${result(ctx, B.addResult)}</div>`;
}

function addIr(ctx) {
  const { state, esc, icon } = ctx, cabs = state.nam.cabs || [], to = addTarget(cabs, B.irSel);
  if (to < 0) return `<h2>Add an IR</h2><p class="muted" style="margin:8px 0 0">All ${IRS} IR slots are full. Remove one to make room.</p>`;
  return `<div class="card-head" style="margin-bottom:12px"><h2>${icon("upload", 18)} Add an IR</h2><span class="faint mono">IR ${two(to)}</span></div>
    <div class="stack" style="gap:12px">
    ${dropZone(ctx, "irdrop", B.ir?.file, B.ir ? `Ready · ${ms(Math.min(CAB_TAPS, B.ir.samples.length))} used` : "", "Drop a .wav impulse response here")}
    ${B.irErr ? `<div class="note bad">${icon("alert-triangle", 16)}<span>${esc(B.irErr)}</span></div>` : ""}
    ${B.ir ? `<label class="field">Name<input type="text" id="irname" maxlength="31" value="${esc(B.ir.name)}" spellcheck="false"></label>` : ""}
    <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="sendir" data-to="${to}" ${B.ir && !state.busy ? "" : "disabled"}>${icon("upload", 16)} Send to IR ${two(to)}</button></div>
    ${result(ctx, B.addResult)}</div>`;
}

// ---------------------------------------------------------------- details (below)

function knobs(ctx) {
  const v = B.vals || [0, 12, 12, 12], R = 21, C = 2 * Math.PI * R, arc = (f) => `${(C * 0.75 * f).toFixed(2)} ${C.toFixed(2)}`;
  return `<div class="dck-row tb-knobs" style="grid-template-columns:repeat(4,minmax(0,1fr))">${TONE_KNOBS.map((k, i) => {
    const f = v[i] / k.max;
    return `<div class="dck" data-tk="${i}"><div class="dck-knob" role="slider" tabindex="0" aria-label="${k.name}" aria-valuemin="0"
        aria-valuemax="${k.max}" aria-valuenow="${v[i]}" aria-valuetext="${k.spoken(v[i])}" title="Drag or scroll to turn. Double-click to reset."><svg viewBox="0 0 56 56" aria-hidden="true">
        <circle class="dck-track" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(1)}" transform="rotate(135 28 28)"/>
        <circle class="dck-val" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(f)}" transform="rotate(135 28 28)"/>
        <circle class="dck-cap" cx="28" cy="28" r="14"/>
        <line class="dck-ptr" x1="28" y1="28" x2="28" y2="17" transform="rotate(${(-135 + 270 * f).toFixed(1)} 28 28)"/></svg></div>
      <span class="dck-value" data-v>${k.text(v[i])}</span><span class="dck-name">${k.name}</span></div>`;
  }).join("")}</div>`;
}

function titleRow(ctx, badge, name, form, max) {
  const { esc, state } = ctx;
  const title = B.mode === "rename"
    ? `<form class="row tb-rename" data-form="${form}" style="flex-wrap:nowrap"><input type="text" id="tb-newname" maxlength="${max}" value="${esc(name)}" spellcheck="false" aria-label="New name"
        ><button class="btn small primary" type="submit" ${state.busy ? "disabled" : ""}>Save</button><button class="btn small ghost" type="button" data-act="cancel">Cancel</button></form>`
    : `<h2 class="tb-title" title="${esc(name)}">${esc(name || "(no name)")}</h2>`;
  return `<div class="tb-head"><span class="tb-slot">${badge}</span><div style="min-width:0;flex:1">${title}</div></div>`;
}

function capDetail(ctx) {
  const { state, esc, icon } = ctx, nam = state.nam, bank = nam.bank, cabs = nam.cabs || [], i = B.sel, s = bank[i];
  if (!s) return `<div class="tb-head"><span class="tb-slot">${two(i)}</span><p class="muted" style="margin:3px 0 0">Empty slot.</p></div>`;
  const playing = s.crc === nam.playing, busy = !!state.busy, ir = nam.irs?.[i] ?? -1;
  const opts = [`<option value="-1" ${ir < 0 ? "selected" : ""}>None</option>`, ...cabs.map((c, k) => c
    ? `<option value="${k}" ${k === ir ? "selected" : ""}>${two(k)}  ${esc(c.name || "(no name)")}</option>` : "")].join("");
  return `${titleRow(ctx, two(i), s.name, "rename", 24)}
    <div class="row tb-actions">
      ${playing ? `<span class="pill world">${icon("player-play", 12)} Playing</span>`
                : nam.layout?.play ? `<button class="btn small primary" data-act="play" ${busy ? "disabled" : ""}>${icon("player-play", 15)} Play on the pedal</button>` : ""}
      <button class="btn small" data-act="rename" ${busy || B.mode ? "disabled" : ""}>${icon("pencil", 15)} Rename</button>
      <button class="btn small" data-act="replace" ${busy ? "disabled" : ""}>${icon("replace", 15)} Replace</button>
      <button class="btn small ghost danger" data-act="remove" ${busy ? "disabled" : ""}>${icon("trash", 15)} Remove</button></div>
    ${result(ctx, B.result)}
    <label class="tb-irrow"><span>${icon("device-speaker", 16)} IR</span>
      <select id="tb-irpick" ${busy || !cabs.some(Boolean) ? "disabled" : ""}>${cabs.some(Boolean) ? opts : `<option>No IRs on the pedal</option>`}</select></label>
    <details class="tb-fold tb-eq" data-fold="eq" ${B.eqOpen ? "open" : ""}><summary>${icon("adjustments-horizontal", 16)} Gate and EQ <span class="faint">${eqSummary()}</span></summary>
      ${knobs(ctx)}</details>`;
}
function eqSummary() {
  const v = B.vals || [0, 12, 12, 12], k = TONE_KNOBS;
  return v[0] === 0 && v[1] === 12 && v[2] === 12 && v[3] === 12 ? "off" : k.map((x, i) => `${x.name.toLowerCase()} ${x.text(v[i])}`).join(", ");
}

function irDetail(ctx) {
  const { state, esc, icon } = ctx, nam = state.nam, cabs = nam.cabs || [], busy = !!state.busy, k = B.irSel, c = cabs[k];
  if (!c) return `<div class="tb-head"><span class="tb-slot">${two(k)}</span><p class="muted" style="margin:3px 0 0">Empty slot.</p></div>`;
  const who = nam.bank.map((s, i) => (s && nam.irs?.[i] === k ? i : -1)).filter((i) => i >= 0);
  return `${titleRow(ctx, two(k), c.name, "irrename", 31)}
    <p class="faint tb-meta">${ms(c.taps)}${c.format === 1 ? " · older format" : ""}</p>
    <div class="row tb-actions">
      <button class="btn small" data-act="rename" ${busy || B.mode ? "disabled" : ""}>${icon("pencil", 15)} Rename</button>
      <button class="btn small" data-act="replace" ${busy ? "disabled" : ""}>${icon("replace", 15)} Replace</button>
      <button class="btn small ghost danger" data-act="irremove" ${busy ? "disabled" : ""}>${icon("trash", 15)} Remove</button></div>
    ${result(ctx, B.result)}
    <div class="tb-irrow"><span>${icon("wave-sine", 16)} Played by</span>
      ${who.length ? `<div class="row" style="gap:6px">${who.map((i) => `<button class="btn small" data-gocap="${i}">${two(i)} ${esc(nam.bank[i].name)}</button>`).join("")}</div>`
                   : `<span class="muted">no captures</span>`}</div>`;
}

// ---------------------------------------------------------------- behaviour

async function takeCap(ctx, name, text, keepName) {
  B.cap = null; B.capErr = null; B.addResult = null; B.converting = true; ctx.render();
  await new Promise((r) => setTimeout(r, 30));
  try {
    const shown = keepName ?? stem(name), { blob, gainDb, levelDb, calibrated } = convertNam(text, shown, opts());
    B.cap = { file: name, text, name: shown, bytes: blob.length, gainDb, levelDb, calibrated };
  } catch (e) { B.capErr = e instanceof NotA2 ? e.message : `Couldn't convert it: ${e.message}`; }
  B.converting = false; ctx.render();
}
async function takeIr(ctx, name, bytes) {
  B.ir = null; B.irErr = null; B.addResult = null; ctx.render();
  try { const { samples, seconds } = await decodeIr(bytes); makeCabFile(samples, "check"); B.ir = { file: name, name: irStem(name), samples, seconds }; }
  catch (e) { B.irErr = e.message; }
  ctx.render();
}
async function dropFile(ctx, f) {                     // a file dropped anywhere: a capture or an IR, by its kind
  if (/\.nam$/i.test(f.name)) { B.tab = "caps"; B.mode = null; return takeCap(ctx, f.name, await f.text()); }
  if (/\.(wav|wave)$/i.test(f.name)) { B.tab = "irs"; B.mode = null; return takeIr(ctx, f.name, new Uint8Array(await f.arrayBuffer())); }
  ctx.toast("Drop a .nam capture or a .wav impulse response");
}

// the knobs: the capture playing changes live; another one's settings go into the record after a pause
function shownCapture(ctx) {
  const nam = ctx.state.nam, i = typeof B.sel === "number" ? B.sel : -1, s = i >= 0 ? nam.bank[i] : null;
  return s ? { i, s, playing: s.crc === nam.playing } : null;
}
function loadVals(ctx) {
  const c = shownCapture(ctx);
  if (!c) { B.vals = null; B.valsFor = null; return; }
  const key = `${c.i}:${c.s.crc}`;
  if (B.valsFor === key && B.vals) return;
  B.valsFor = key;
  B.vals = c.playing && B.live ? B.live.v.slice() : toneEntry(ctx.state.nam.entries, c.i, c.s.crc).v;
}
function refreshKnobs(root) {
  if (!B.vals) return;
  const R = 21, C = 2 * Math.PI * R, arc = (f) => `${(C * 0.75 * f).toFixed(2)} ${C.toFixed(2)}`;
  root.querySelectorAll("[data-tk]").forEach((box) => {
    const i = +box.dataset.tk, k = TONE_KNOBS[i], v = B.vals[i], f = v / k.max, knob = box.querySelector(".dck-knob");
    box.querySelector(".dck-val").setAttribute("stroke-dasharray", arc(f));
    box.querySelector(".dck-ptr").setAttribute("transform", `rotate(${(-135 + 270 * f).toFixed(1)} 28 28)`);
    box.querySelector("[data-v]").textContent = k.text(v);
    knob.setAttribute("aria-valuenow", v); knob.setAttribute("aria-valuetext", k.spoken(v));
  });
  const sum = root.querySelector('[data-fold="eq"] summary .faint'); if (sum) sum.textContent = eqSummary();
}
async function flushLive(ctx) {
  B.sending = true;
  try {
    while (B.queue.size) {
      const [i, v] = B.queue.entries().next().value;
      B.queue.delete(i);
      await ctx.linkQuiet((link) => paramSet(link, NAM_P.GATE + i, v));
    }
  } catch (e) { B.result = { ok: false, text: `Couldn't reach the pedal: ${e.message}` }; ctx.render(); }
  finally { B.sending = false; }
}
function setKnob(ctx, root, i, x) {
  const c = shownCapture(ctx), k = TONE_KNOBS[i];
  if (!c || !B.vals) return;
  x = Math.max(0, Math.min(k.max, Math.round(x)));
  if (x === B.vals[i]) return;
  B.vals[i] = x; B.local[i] = Date.now();
  refreshKnobs(root);
  if (c.playing) { B.queue.set(i, x); if (!B.sending) flushLive(ctx); return; }
  clearTimeout(B.saveTimer);
  const v = B.vals.slice(), at = c.i, crc = c.s.crc;
  B.saveTimer = setTimeout(async () => {                // a pause after the last turn: one write to the record
    try { const entries = await ctx.linkQuiet((link) => setToneEntry(link, at, crc, { v })); ctx.state.nam.entries = entries; }
    catch (e) { B.result = { ok: false, text: `Couldn't save it on the pedal: ${e.message}` }; ctx.render(); }
  }, 600);
}
function wireKnob(ctx, root, box) {
  const i = +box.dataset.tk, k = TONE_KNOBS[i], knob = box.querySelector(".dck-knob");
  let y0 = 0, x0 = 0, pid = null;
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !B.vals) return;
    e.preventDefault(); knob.focus();
    try { knob.setPointerCapture(e.pointerId); } catch { /* without capture */ }
    pid = e.pointerId; B.drag = i; y0 = e.clientY; x0 = B.vals[i]; knob.classList.add("turning");
  });
  knob.addEventListener("pointermove", (e) => { if (B.drag === i && e.pointerId === pid) setKnob(ctx, root, i, x0 + ((y0 - e.clientY) * (e.shiftKey ? 0.25 : 1) / 200) * k.max); });
  const up = (e) => { if (e.pointerId !== pid) return; try { knob.releasePointerCapture(e.pointerId); } catch { /* */ } pid = null; B.drag = -1; knob.classList.remove("turning"); };
  knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", up);
  knob.addEventListener("wheel", (e) => { if (!B.vals) return; e.preventDefault(); setKnob(ctx, root, i, B.vals[i] + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    if (!B.vals) return;
    const x = B.vals[i], to = { ArrowUp: x + 1, ArrowRight: x + 1, ArrowDown: x - 1, ArrowLeft: x - 1, PageUp: x + 6, PageDown: x - 6, Home: 0, End: k.max }[e.key];
    if (to === undefined) return;
    e.preventDefault(); setKnob(ctx, root, i, to);
  });
  knob.addEventListener("dblclick", () => setKnob(ctx, root, i, k.def));
}

// what the pedal plays, and its gate / EQ / IR, every 1.5 s while this page shows (changes made on the pedal show up)
async function poll() {
  const ctx = B.ctx;
  if (!ctx || ctx.state.busy || B.sending || B.queue.size || B.drag >= 0 || !ctx.state.nam?.layout?.irBank) return;
  const got = await ctx.linkQuiet((link) => paramsRead(link, NAM_P.GATE, 6)).catch(() => null);
  if (!got || got.length < 5) return;
  const nam = ctx.state.nam, now = Date.now();
  const slot = got.length >= 6 ? got[5] - 1 : null;
  B.live = { v: got.slice(0, 4), ir: got[4] - 1, slot };
  let again = false;
  if (slot !== null) {
    const crc = slot >= 0 ? nam.bank[slot]?.crc : null;
    if (crc && crc !== nam.playing) { nam.playing = crc; again = true; }
  }
  const c = shownCapture(ctx);
  if (c?.playing) {
    if (nam.irs && nam.irs[c.i] !== B.live.ir) { nam.irs[c.i] = B.live.ir; again = true; }
    if (B.vals && B.valsFor === `${c.i}:${c.s.crc}`) B.live.v.forEach((v, i) => { if (now - B.local[i] >= 1500) B.vals[i] = v; });
    else { B.valsFor = null; again = true; }
  }
  const root = document.querySelector("#tb-panel");
  if (again) ctx.render(); else if (root) refreshKnobs(root);
}

// Replace: pick a file, then confirm; it goes into the same slot (a new capture starts with its own settings)
async function replaceCap(ctx) {
  const i = B.sel, old = ctx.state.nam.bank[i];
  const f = await ctx.openFile("Choose the new capture", [{ name: "NAM capture", extensions: ["nam"] }]);
  if (!f) return;
  let c;
  try { c = convertNam(new TextDecoder().decode(f.bytes), stem(f.name), opts()); }
  catch (e) { B.result = { ok: false, text: e instanceof NotA2 ? e.message : `Couldn't convert it: ${e.message}` }; ctx.render(); return; }
  if (!(await ctx.confirm(`Replace “${old.name}” with “${c.name}”?`, "Its IR, gate and EQ go back to none, off and flat.", "Replace"))) return;
  try {
    const ok = await ctx.withLink("Replacing a capture", async (link) => { const r = await putToneFile(link, i, c.blob); await ctx.loadNam(link); return r; });
    B.valsFor = null; B.result = ok ? null : { ok: false, text: "Written, but the pedal hasn't confirmed it's playing." };
    ctx.toast(`Slot ${two(i)} is now “${c.name}”`);
  } catch (e) { B.result = { ok: false, text: e.message }; }
  ctx.render();
}
async function replaceIr(ctx) {
  const k = B.irSel, old = ctx.state.nam.cabs[k];
  const f = await ctx.openFile("Choose the new impulse response", [{ name: "Impulse response", extensions: ["wav", "wave"] }]);
  if (!f) return;
  let file, name = irStem(f.name);
  try { file = makeCabFile((await decodeIr(f.bytes)).samples, name); }
  catch (e) { B.result = { ok: false, text: e.message }; ctx.render(); return; }
  if (!(await ctx.confirm(`Replace “${old.name}” with “${name}”?`, "Captures that play it will play the new one.", "Replace"))) return;
  try { await ctx.withLink("Replacing an IR", async (link) => { await putCabFile(link, k, file); await ctx.loadNam(link); }); B.result = null; ctx.toast(`IR ${two(k)} is now “${name}”`); }
  catch (e) { B.result = { ok: false, text: e.message }; }
  ctx.render();
}

// The two columns fill the window's height (the list scrolls inside); again when the window is resized
function fit(root) {
  const g = root.querySelector("#tb-panel");
  if (!g) return;
  const main = g.closest("main") || document.scrollingElement, mr = main.getBoundingClientRect(), pad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
  const h = Math.max(420, Math.floor(mr.bottom - pad - (g.getBoundingClientRect().top + main.scrollTop - mr.top) - mr.top));
  g.style.height = `${h}px`;
  if (!fit.on) { fit.on = true; window.addEventListener("resize", () => { const r = document.querySelector("#tb-panel"); if (r) fit(r.parentElement); }); }
}

export function mountBank(root, ctx) {
  B.ctx = ctx;
  const nam = ctx.state.nam;
  loadVals(ctx);
  if (B.vals) refreshKnobs(root);
  const $ = (s) => root.querySelector(s);
  const go = (fn) => { fn(); ctx.render(); };
  // tabs (arrow keys move between them)
  root.querySelectorAll("[data-tab]").forEach((t) => {
    t.onclick = () => go(() => { if (B.tab !== t.dataset.tab) { B.tab = t.dataset.tab; B.mode = null; B.result = null; } });
    t.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); B.tab = B.tab === "caps" ? "irs" : "caps"; B.mode = null; ctx.render(); document.querySelector(`[data-tab="${B.tab}"]`)?.focus();
    };
  });
  // lists: click or Enter picks; arrows, Home, End move (one Tab stop)
  const wireList = (attr, choose) => root.querySelectorAll(`[${attr}]`).forEach((r) => {
    r.onclick = () => choose(r.getAttribute(attr));
    r.onkeydown = (e) => {
      const all = [...root.querySelectorAll(`[${attr}]`)], i = all.indexOf(r);
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r.getAttribute(attr)); return; }
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const n = all[Math.max(0, Math.min(all.length - 1, to))];
      r.tabIndex = -1; n.tabIndex = 0; n.focus(); choose(n.getAttribute(attr), true);
    };
  });
  const focusSel = (attr, v) => document.querySelector(`[${attr}="${v}"]`)?.focus();
  wireList("data-slot", (v, kb) => { if (+v !== B.sel) { B.sel = +v; B.mode = null; B.result = null; B.valsFor = null; } ctx.render(); if (kb) focusSel("data-slot", v); });
  wireList("data-ir", (v, kb) => { if (+v !== B.irSel) { B.irSel = +v; B.mode = null; B.result = null; } ctx.render(); if (kb) focusSel("data-ir", v); });
  root.querySelectorAll("[data-gocap]").forEach((b) => b.onclick = () => go(() => { B.tab = "caps"; B.sel = +b.dataset.gocap; B.mode = null; B.result = null; B.valsFor = null; }));

  // drop anywhere on the page
  const panel = $("#tb-panel"), cover = $(".tb-dropcover");
  if (panel) {
    let depth = 0;
    panel.ondragenter = (e) => { if (![...(e.dataTransfer?.types || [])].includes("Files")) return; depth++; cover.hidden = false; };
    panel.ondragleave = () => { if (--depth <= 0) { depth = 0; cover.hidden = true; } };
    panel.ondragover = (e) => e.preventDefault();
    panel.ondrop = (e) => { e.preventDefault(); depth = 0; cover.hidden = true; const f = e.dataTransfer.files[0]; if (f) dropFile(ctx, f); };
  }
  root.querySelectorAll("[data-pickfile]").forEach((b) => b.onclick = async () => {
    const cap = b.dataset.pickfile === "namdrop";
    const f = await ctx.openFile(cap ? "Choose a NAM capture" : "Choose a cab impulse response",
      [cap ? { name: "NAM capture", extensions: ["nam"] } : { name: "Impulse response", extensions: ["wav", "wave"] }]);
    if (!f) return;
    if (cap) takeCap(ctx, f.name, new TextDecoder().decode(f.bytes)); else takeIr(ctx, f.name, f.bytes);
  });
  root.querySelectorAll("[data-fold]").forEach((d) => d.ontoggle = () => { if (d.dataset.fold === "conv") B.convOpen = d.open; else B.eqOpen = d.open; });
  fit(root);
  root.querySelectorAll("[data-pref]").forEach((c) => c.onchange = () => {
    setPref(c.dataset.pref, c.checked);
    if (B.cap) takeCap(ctx, B.cap.file, B.cap.text, B.cap.name); else ctx.render();
  });
  const capname = $("#capname"); if (capname) capname.oninput = () => { B.cap.name = capname.value; };
  const irname = $("#irname"); if (irname) irname.oninput = () => { B.ir.name = irname.value; };

  const act = (name, fn) => root.querySelectorAll(`[data-act="${name}"]`).forEach((b) => b.onclick = (e) => fn(b, e));
  act("cancel", () => go(() => { B.mode = null; B.cap = null; B.ir = null; B.capErr = null; B.irErr = null; }));
  act("rename", () => { B.mode = "rename"; B.result = null; ctx.render(); const n = document.querySelector("#tb-newname"); n?.focus(); n?.select(); });
  act("replace", () => (B.tab === "caps" ? replaceCap(ctx) : replaceIr(ctx)));
  const rn = $("#tb-newname");
  if (rn) rn.onkeydown = (e) => { if (e.key === "Escape") { e.preventDefault(); B.mode = null; ctx.render(); } };

  // captures
  act("play", async () => {
    const i = B.sel, s = nam.bank[i];
    try {
      const ok = await ctx.withLink("Playing it on the pedal", async (link) => { const r = await playSlot(link, i, s.crc); await ctx.loadNam(link); return r; });
      B.valsFor = null;
      if (!ok) B.result = { ok: false, text: "The pedal took it but hasn't confirmed it plays." };
    } catch (e) { B.result = { ok: false, text: e.message }; }
    ctx.render();
  });
  const renameForm = root.querySelector('[data-form="rename"]');
  if (renameForm) renameForm.onsubmit = async (e) => {
    e.preventDefault();
    const i = B.sel, name = rn.value.trim(), s = nam.bank[i];
    if (!name || name === s.name) { B.mode = null; ctx.render(); return; }
    try {
      await ctx.withLink("Renaming a capture", async (link) => { await renameCapture(link, i, name); await ctx.loadNam(link); });
      B.mode = null; B.valsFor = null; ctx.toast(`Slot ${two(i)} is now “${name}”`);
    } catch (e2) { B.result = { ok: false, text: e2.message }; }
    ctx.render();
  };
  act("sendcap", async (b) => {
    const to = +b.dataset.to;
    B.addResult = null; B.progress = 0; ctx.render();
    try {
      const c = convertNam(B.cap.text, B.cap.name.trim() || stem(B.cap.file), opts());
      const ok = await ctx.withLink("Sending a capture", async (link) => {
        const r = await putToneFile(link, to, c.blob, (f) => { B.progress = f; const p = document.querySelector("#tb-panel progress"); if (p) p.value = f; });
        await ctx.loadNam(link); return r;
      });
      B.cap = null; B.mode = null; B.sel = to; B.valsFor = null; B.result = null;
      B.addResult = { ok, text: ok ? `“${c.name}” is in slot ${two(to)} and playing.` : `Written to slot ${two(to)}, but the pedal hasn't confirmed it's playing.` };
    } catch (e) { B.addResult = { ok: false, text: e.message }; }
    B.progress = null; ctx.render();
  });
  act("remove", async () => {
    const i = B.sel, s = nam.bank[i];
    if (!(await ctx.confirm(`Remove “${s.name}”?`, `Slot ${two(i)} becomes empty. A backup keeps a copy if you made one.`, "Remove", true))) return;
    try { await ctx.withLink("Removing a capture", async (link) => { await emptyToneFile(link, i); await ctx.loadNam(link); }); B.sel = null; B.result = null; ctx.toast(`Slot ${two(i)} is empty`); }
    catch (e) { B.result = { ok: false, text: e.message }; }
    ctx.render();
  });
  const irpick = $("#tb-irpick");
  if (irpick) irpick.onchange = async () => {
    const c = shownCapture(ctx), k = +irpick.value;
    if (!c) return;
    try {
      await ctx.withLink("Choosing a cab IR", async (link) => {
        if (c.playing) await paramSet(link, NAM_P.IR, k + 1); else await setToneEntry(link, c.i, c.s.crc, { ir: k });
        await ctx.loadNam(link);
      });
      ctx.toast(k < 0 ? `Slot ${two(c.i)} plays without an IR` : `Slot ${two(c.i)} plays “${nam.cabs[k]?.name || `IR ${two(k)}`}”`);
    } catch (e) { B.result = { ok: false, text: e.message }; ctx.render(); }
  };
  root.querySelectorAll("[data-tk]").forEach((box) => wireKnob(ctx, root, box));

  // IRs
  act("sendir", async (b) => {
    const k = +b.dataset.to;
    B.addResult = null; ctx.render();
    try {
      const name = B.ir.name.trim() || irStem(B.ir.file), file = makeCabFile(B.ir.samples, name);
      await ctx.withLink("Sending an IR", async (link) => { await putCabFile(link, k, file); await ctx.loadNam(link); });
      B.ir = null; B.mode = null; B.irSel = k; B.result = null;
      B.addResult = { ok: true, text: `“${name}” is IR ${two(k)}.` };
    } catch (e) { B.addResult = { ok: false, text: e.message }; }
    ctx.render();
  });
  const irForm = root.querySelector('[data-form="irrename"]');
  if (irForm) irForm.onsubmit = async (e) => {
    e.preventDefault();
    const k = B.irSel, name = rn.value.trim();
    if (!name || name === nam.cabs[k].name) { B.mode = null; ctx.render(); return; }
    try { await ctx.withLink("Renaming a cab IR", async (link) => { await renameCab(link, k, name); await ctx.loadNam(link); }); B.mode = null; ctx.toast(`IR ${two(k)} is now “${name}”`); }
    catch (e2) { B.result = { ok: false, text: e2.message }; }
    ctx.render();
  };
  act("irremove", async () => {
    const k = B.irSel, c = nam.cabs[k], n = nam.irs?.filter((x) => x === k).length || 0;
    if (!(await ctx.confirm(`Remove “${c.name}”?`, `IR ${two(k)} becomes empty.${n ? ` The ${n} capture${n === 1 ? "" : "s"} playing it ${n === 1 ? "plays" : "play"} without an IR.` : ""}`, "Remove", true))) return;
    try { await ctx.withLink("Removing a cab IR", async (link) => { await removeCabFile(link, k); await ctx.loadNam(link); }); B.irSel = null; B.result = null; ctx.toast(`IR ${two(k)} is empty`); }
    catch (e) { B.result = { ok: false, text: e.message }; }
    ctx.render();
  });
  act("shrink", async () => {
    try { const n = await ctx.withLink("Making IRs smaller", async (link) => { const m = await shrinkCabs(link); await ctx.loadNam(link); return m; }); ctx.toast(`${n} IR${n === 1 ? "" : "s"} made smaller`); }
    catch (e) { B.result = { ok: false, text: e.message }; }
    ctx.render();
  });

  if (!B.timer) B.timer = setInterval(() => {
    if (!document.querySelector("#tb-panel")) { clearInterval(B.timer); B.timer = null; return; }
    poll();
  }, 1500);
}

/** another pedal or firmware: start over */
export function resetBank() { Object.assign(B, { sel: null, irSel: null, cap: null, ir: null, mode: null, result: null, vals: null, valsFor: null, live: null }); B.queue.clear(); }
