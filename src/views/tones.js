// Tones: NAM Loader's 12 slots. Drop a .nam (A2 captures only), name it, choose a slot, send; the
// pedal plays it at once. Converting happens here (gp5nam.js, the same bytes as the Python converter).
// Each slot can have a cab IR of its own (NAM Loader 1.1: file "cab-NN"; lib/cabir.js makes it from a .wav).
import { convertNam, putCapture, emptySlot, NotA2, SLOTS } from "../lib/gp5nam.js";
import { putToneFile, emptyToneFile, moveTonesToFiles, putCabFile, removeCabFile } from "../lib/namfiles.js";
import { decodeIr, makeCabFile, CAB_TAPS, CAB_RATE } from "../lib/cabir.js";

const ui = { cap: null, err: null, sel: null, progress: null, result: null, converting: false,
            ir: null, irErr: null, irResult: null };   /* ir: { file, name, samples, seconds } */
const two = (i) => String(i + 1).padStart(2, "0");
// the two conversion switches (as the NAM plugin's "Calibrate input" and "Normalize output"), kept on this computer
const PREFS = { calibrate: "nam-calibrate", level: "nam-level" };
function pref(k) { try { return localStorage.getItem(PREFS[k]) !== "off"; } catch { return true; } }
function setPref(k, on) { try { localStorage.setItem(PREFS[k], on ? "on" : "off"); } catch { /* no storage: this session only */ } }
const opts = () => ({ calibrate: pref("calibrate"), level: pref("level") });
const db = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)} dB`;
function levels(c) {                                        // what the switches did to this capture, in words
  const o = opts(), a = [];
  if (o.calibrate) a.push(c.calibrated ? `input ${db(c.gainDb)} (matched to how it was recorded)` : "input as is (the file doesn't say how it was recorded)");
  if (o.level) a.push(`loudness ${db(c.levelDb)}`);
  return a.join(" · ");
}
const stem = (f) => f.replace(/\.nam$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);

async function take(ctx, name, text, keepName) {
  ui.cap = null; ui.err = null; ui.result = null; ui.converting = true; ctx.render();
  await new Promise((r) => setTimeout(r, 30));            // show "Converting" first (it takes about a second)
  try {
    const shown = keepName ?? stem(name), { blob, gainDb, levelDb, calibrated } = convertNam(text, shown, opts());
    ui.cap = { file: name, text, name: shown, bytes: blob.length, gainDb, levelDb, calibrated };
  } catch (e) { ui.err = e instanceof NotA2 ? e.message : `Couldn't convert it: ${e.message}`; }
  ui.converting = false; ctx.render();
}

const irStem = (f) => f.replace(/\.(wav|wave)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
async function takeIr(ctx, name, bytes) {
  ui.ir = null; ui.irErr = null; ui.irResult = null; ctx.render();
  try {
    const { samples, seconds } = await decodeIr(bytes);
    makeCabFile(samples, "check");                         // throws for an unusable one
    ui.ir = { file: name, name: irStem(name), samples, seconds };
  } catch (e) { ui.irErr = e.message; }
  ctx.render();
}

export default {
  id: "tones", title: "Tones", icon: "wave-sine", world: "w-nam",
  available: (state) => state.pedal?.firmware?.kind === "nam",
  render(ctx) {
    const { state, esc, icon } = ctx, fw = state.pedal?.firmware?.kind;
    const used = state.nam ? state.nam.bank.filter(Boolean).length : 0;
    const head = ctx.banner("w-nam", "wave-sine", "Tones", "",
      { chips: fw === "nam" && state.nam ? [`${used} of ${SLOTS} slots in use`] : [] });
    if (fw !== "nam" || !state.nam) {
      return head + `<section class="card w-nam" style="max-width:640px"><div class="card-head"><h2>${state.pedal ? "This firmware has no tone slots" : "No pedal connected"}</h2></div>
        <p class="muted">Needs NAM Loader.</p>
        <div style="margin-top:12px"><button class="btn primary" data-go="flash">${icon("bolt", 16)} Go to Flash</button></div></section>`;
    }
    const bank = state.nam.bank;
    if (ui.sel === null || ui.sel >= SLOTS) { const f = bank.findIndex((s) => !s); ui.sel = f >= 0 ? f : 0; }
    const rows = bank.map((s, i) => `<div class="item pick ${i === ui.sel ? "sel" : ""}" data-slot="${i}" role="button" tabindex="${i === ui.sel ? 0 : -1}" aria-pressed="${i === ui.sel}" ${s ? 'aria-keyshortcuts="Delete"' : ""} aria-label="Slot ${two(i)}: ${s ? esc(s.name || "no name") : "empty"}">
        <span class="n">${two(i)}</span>
        <span class="main"><span class="name ${s ? "" : "empty"}">${s ? esc(s.name || "(no name)") : "empty"}</span></span>
        ${s && s.old ? '<span class="pill" title="Old storage: move it with the button above">old</span>' : ""}
        ${state.nam.cabs?.[i] ? `<span class="pill" title="Cab IR: ${esc(state.nam.cabs[i].name || "(no name)")}">${icon("device-speaker", 12)} cab</span>` : ""}
        ${s && s.crc === state.nam.playing ? `<span class="pill world">${icon("player-play", 12)} playing</span>` : ""}
        ${s ? `<button class="btn small ghost icon-only" data-rm="${i}" tabindex="${i === ui.sel ? 0 : -1}" aria-label="Empty slot ${i + 1}" title="Empty this slot (Delete)">${icon("trash", 15)}</button>` : ""}
      </div>`).join("");
    const target = bank[ui.sel], busy = !!state.busy;
    const legacy = state.nam.legacy || [];
    const move = legacy.length ? `<div class="note warn" style="margin-bottom:var(--gap);align-items:center"><span style="flex:1">${icon("info-circle", 16)}
        <b>${legacy.length} tone${legacy.length === 1 ? " is" : "s are"} in the old storage.</b> Move ${legacy.length === 1 ? "it" : "them"} once (about ${legacy.length * 3} s).</span>
        <button class="btn primary" data-act="move" ${busy ? "disabled" : ""}>Move ${legacy.length === 1 ? "it" : "them"}</button></div>` : "";
    return head + move + `<div class="cols w-nam" style="--n:2">
      <section class="card"><div class="card-head"><h2>${icon("list", 18)} Slots</h2><span class="faint mono">${used}/${SLOTS}</span></div>
        <div class="list">${rows}</div></section>
      <div class="stack" style="gap:var(--gap)">
      <section class="card"><div class="card-head"><h2>${icon("upload", 18)} Add a capture</h2></div><div class="stack">
        <div class="drop" id="namdrop">${icon("file-music", 26)}
          <div style="flex:1;min-width:0">${ui.converting ? "Converting…" : ui.cap
            ? `<b style="color:var(--text);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ui.cap.file)}</b><span style="color:var(--good);font-size:13px">A2 capture, ready · ${(ui.cap.bytes / 1024).toFixed(1)} KB</span>${levels(ui.cap) ? `<span class="muted" style="display:block;font-size:12.5px">${esc(levels(ui.cap))}</span>` : ""}`
            : "Drop a NAM capture (.nam) here"}</div>
          <button class="btn small" data-act="open">${ui.cap ? "Another" : "Choose file"}</button></div>
        ${ui.err ? `<div class="note bad">${icon("alert-triangle", 16)}<span>${esc(ui.err)}</span></div>` : ""}
        ${ui.cap ? `<label class="field">Name on the pedal<input type="text" id="capname" maxlength="24" value="${esc(ui.cap.name)}" spellcheck="false"></label>` : ""}
        <div class="stack" style="gap:8px">
          <label class="row between" style="flex-wrap:nowrap;gap:12px"><span style="min-width:0"><b style="font-weight:600">Calibrate input</b><span class="faint" style="display:block;font-size:12.5px">Drive the capture as hard as the gear was played, when the file says how it was recorded</span></span>
            <input type="checkbox" class="switch" role="switch" data-pref="calibrate" ${pref("calibrate") ? "checked" : ""}></label>
          <label class="row between" style="flex-wrap:nowrap;gap:12px"><span style="min-width:0"><b style="font-weight:600">Even out loudness</b><span class="faint" style="display:block;font-size:12.5px">Every tone equally loud. Off: as loud as the captured gear was</span></span>
            <input type="checkbox" class="switch" role="switch" data-pref="level" ${pref("level") ? "checked" : ""}></label>
          <p class="faint" style="font-size:12.5px">They apply to captures you send from now on. NAM A2 captures only.</p>
        </div>
        <div class="row between" style="flex-wrap:nowrap"><span class="muted" style="font-size:13px;min-width:0">${!ui.cap ? "Choose a capture first." : target ? `Replaces “${esc(target.name)}”` : `Into the empty slot ${two(ui.sel)}`}</span>
          <button class="btn primary" data-act="send" ${ui.cap && !busy ? "" : "disabled"}>${icon("upload", 16)} ${target ? "Replace" : "Send to"} slot ${two(ui.sel)}</button></div>
        ${ui.progress !== null ? `<progress max="1" value="${ui.progress}"></progress>` : ""}
        ${ui.result ? `<div class="note ${ui.result.ok ? "good" : "bad"}">${icon(ui.result.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(ui.result.text)}</span></div>` : ""}
      </div></section>
      ${irCard(ctx, bank, busy)}
      </div></div>`;
  },
  mount(root, ctx) {
    mountIr(root, ctx);
    root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => ctx.go(b.dataset.go));
    if (!root.querySelector("#namdrop")) return;
    const pick = (i) => { ui.sel = i; ctx.render(); document.querySelector(`[data-slot="${i}"]`)?.focus(); };
    root.querySelectorAll("[data-slot]").forEach((r) => {
      r.onclick = (e) => { if (e.target.closest("[data-rm]")) return; pick(+r.dataset.slot); };
      // one Tab stop for the list (roving tabindex): arrows, Home and End move; Enter or Space picks; Delete empties
      r.onkeydown = (e) => {
        if (e.target !== r) return;
        const all = [...root.querySelectorAll("[data-slot]")], i = all.indexOf(r);
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(+r.dataset.slot); return; }
        if (e.key === "Delete" || e.key === "Backspace") { const rm = r.querySelector("[data-rm]"); if (rm) { e.preventDefault(); rm.click(); } return; }
        const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        const t = all[Math.max(0, Math.min(all.length - 1, to))];
        r.tabIndex = -1; t.tabIndex = 0; t.focus();
      };
    });
    root.querySelector('[data-act="open"]').onclick = async () => {
      const f = await ctx.openFile("Choose a NAM capture", [{ name: "NAM capture", extensions: ["nam"] }]);
      if (f) take(ctx, f.name, new TextDecoder().decode(f.bytes));
    };
    const drop = root.querySelector("#namdrop");
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) take(ctx, f.name, await f.text()); };
    root.querySelectorAll("[data-pref]").forEach((c) => c.onchange = () => {
      setPref(c.dataset.pref, c.checked);
      if (ui.cap) take(ctx, ui.cap.file, ui.cap.text, ui.cap.name); else ctx.render();
    });
    const nameField = root.querySelector("#capname");
    if (nameField) nameField.oninput = () => { ui.cap.name = nameField.value; };
    root.querySelector('[data-act="send"]').onclick = async () => {
      const slot = ui.sel, old = ctx.state.nam?.bank[slot];
      if (old && !(await ctx.confirm(`Replace “${old.name}”?`, `Slot ${two(slot)} gets the new capture.`, "Replace"))) return;
      ui.result = null; ui.progress = 0; ctx.render();
      try {
        const c = convertNam(ui.cap.text, ui.cap.name.trim() || stem(ui.cap.file), opts()), { blob, name } = c, how = levels(c);
        const ok = await ctx.withLink("Sending a capture", async (link) => {
          const prog = (f) => { ui.progress = f; const p = document.querySelector("progress"); if (p) p.value = f; };
          const r = ctx.state.nam?.files ? await putToneFile(link, slot, blob, prog) : await putCapture(link, slot, blob, prog);
          await ctx.loadNam(link);
          return r;
        });
        ui.result = { ok, text: ok ? `“${name}” is in slot ${two(slot)} and playing${how ? ` (${how})` : ""}.` : `Written to slot ${two(slot)}, but the pedal hasn't confirmed it's playing.` };
        const next = ctx.state.nam?.bank.findIndex((s) => !s) ?? -1; if (ok && next >= 0) ui.sel = next;
      } catch (e) { ui.result = { ok: false, text: e.message }; }
      ui.progress = null; ctx.render();
    };
    root.querySelector('[data-act="move"]')?.addEventListener("click", async () => {
      ui.result = null; ui.progress = 0; ctx.render();
      try {
        const n = await ctx.withLink("Moving tones", async (link) => { const m = await moveTonesToFiles(link, (f) => { ui.progress = f; }); await ctx.loadNam(link); return m; });
        ui.result = { ok: true, text: `Moved ${n} tone${n === 1 ? "" : "s"} into the pedal's storage.` };
      } catch (e) { ui.result = { ok: false, text: e.message }; }
      ui.progress = null; ctx.render();
    });
    root.querySelectorAll("[data-rm]").forEach((b) => b.onclick = async () => {
      const i = +b.dataset.rm, s = ctx.state.nam?.bank[i];
      if (!s || !(await ctx.confirm(`Empty slot ${two(i)}?`, `“${s.name}” is removed from the pedal. A backup keeps a copy if you made one.`, "Empty slot", true))) return;
      try { await ctx.withLink("Emptying a slot", async (link) => { if (ctx.state.nam?.files && !s.old) await emptyToneFile(link, i); else await emptySlot(link, i); await ctx.loadNam(link); }); ctx.toast(`Slot ${two(i)} is empty`); }
      catch (e) { ui.result = { ok: false, text: e.message }; ctx.render(); }
    });
  },
};

// ---- the selected slot's cab IR
function irCard(ctx, bank, busy) {
  const { state, esc, icon } = ctx, cab = state.nam.cabs?.[ui.sel], tone = bank[ui.sel];
  if (!state.nam.files) return "";                          // cab IRs live in storage files (platform 0.4 and later)
  const ms = (n) => `${Math.round((n / CAB_RATE) * 1000)} ms`;
  return `<section class="card"><div class="card-head"><h2>${icon("device-speaker", 18)} Cab IR for slot ${two(ui.sel)}</h2></div><div class="stack">
    <div class="row between" style="flex-wrap:nowrap">
      <span class="muted" style="min-width:0">${cab ? `<b style="color:var(--text)">${esc(cab.name || "(no name)")}</b> · ${ms(cab.taps)}` : "No cab IR: the capture plays as it is."}</span>
      ${cab ? `<button class="btn small" data-act="irrm" ${busy ? "disabled" : ""}>${icon("trash", 15)} Remove</button>` : ""}</div>
    <div class="drop" id="irdrop">${icon("file-music", 26)}
      <div style="flex:1;min-width:0">${ui.ir
        ? `<b style="color:var(--text);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ui.ir.file)}</b><span style="color:var(--good);font-size:13px">Impulse response, ${ms(Math.min(CAB_TAPS, ui.ir.samples.length))} used</span>`
        : "Drop a cab impulse response (.wav) here"}</div>
      <button class="btn small" data-act="iropen">${ui.ir ? "Another" : "Choose file"}</button></div>
    ${ui.irErr ? `<div class="note bad">${icon("alert-triangle", 16)}<span>${esc(ui.irErr)}</span></div>` : ""}
    ${ui.ir ? `<label class="field">Name<input type="text" id="irname" maxlength="31" value="${esc(ui.ir.name)}" spellcheck="false"></label>` : ""}
    <div class="row between" style="flex-wrap:nowrap"><span class="muted" style="font-size:13px;min-width:0">${!tone ? "Put a capture in this slot first." : !ui.ir ? "Choose an impulse response first." : cab ? `Replaces “${esc(cab.name)}”` : ""}</span>
      <button class="btn primary" data-act="irsend" ${ui.ir && tone && !busy ? "" : "disabled"}>${icon("upload", 16)} ${cab ? "Replace" : "Add to"} slot ${two(ui.sel)}</button></div>
    ${ui.irResult ? `<div class="note ${ui.irResult.ok ? "good" : "bad"}">${icon(ui.irResult.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(ui.irResult.text)}</span></div>` : ""}
    <p class="faint" style="font-size:12.5px">For captures of an amp without a cab (DI). A capture that already has a cab sounds boxy with a second one. The first ${ms(CAB_TAPS)} of the IR are used, levelled to the same loudness as every other IR.</p>
  </div></section>`;
}

function mountIr(root, ctx) {
  const drop = root.querySelector("#irdrop");
  if (!drop) return;
  root.querySelector('[data-act="iropen"]').onclick = async () => {
    const f = await ctx.openFile("Choose a cab impulse response", [{ name: "Impulse response", extensions: ["wav", "wave"] }]);
    if (f) takeIr(ctx, f.name, f.bytes);
  };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) takeIr(ctx, f.name, new Uint8Array(await f.arrayBuffer())); };
  const nameField = root.querySelector("#irname");
  if (nameField) nameField.oninput = () => { ui.ir.name = nameField.value; };
  root.querySelector('[data-act="irsend"]').onclick = async () => {
    const slot = ui.sel, old = ctx.state.nam?.cabs?.[slot];
    if (old && !(await ctx.confirm(`Replace the cab IR “${old.name}”?`, `Slot ${two(slot)} gets the new one.`, "Replace"))) return;
    ui.irResult = null; ctx.render();
    try {
      const name = ui.ir.name.trim() || irStem(ui.ir.file), file = makeCabFile(ui.ir.samples, name);
      await ctx.withLink("Sending a cab IR", async (link) => { await putCabFile(link, slot, file); await ctx.loadNam(link); });
      ui.irResult = { ok: true, text: `“${name}” is slot ${two(slot)}'s cab IR. It plays with that capture.` };
      ui.ir = null;
    } catch (e) { ui.irResult = { ok: false, text: e.message }; }
    ctx.render();
  };
  root.querySelector('[data-act="irrm"]')?.addEventListener("click", async () => {
    const slot = ui.sel, old = ctx.state.nam?.cabs?.[slot];
    if (!old || !(await ctx.confirm(`Remove slot ${two(slot)}'s cab IR?`, `“${old.name}” is removed; the capture plays without a cab.`, "Remove", true))) return;
    try { await ctx.withLink("Removing a cab IR", async (link) => { await removeCabFile(link, slot); await ctx.loadNam(link); }); ctx.toast(`Slot ${two(slot)}: cab IR removed`); }
    catch (e) { ui.irResult = { ok: false, text: e.message }; ctx.render(); }
  });
}
