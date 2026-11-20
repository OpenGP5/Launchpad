// Live: any OpenGP5 1.0 firmware's parameters and presets, built from what the firmware describes (lib/params.js).
// Groups become cards; a number is a knob, a choice a row of buttons, a read-only value is shown as it changes.
// Presets (when the firmware keeps them): load, save, rename. Rendered once, then updated in place (a re-render
// would drop the knob being turned). Dreamcatcher and NAM Loader have their own pages, so this one isn't shown for
// them.
import { FLAG, UNIT, readValues, setValue, valueText, formatValue, readPresets, loadPreset, savePreset, renamePreset } from "../lib/params.js";

const R = 21, CIRC = 2 * Math.PI * R, SWEEP = 0.75, HOLD_MS = 1500, POLL_MS = 1500;
const arc = (f) => `${(CIRC * SWEEP * f).toFixed(2)} ${CIRC.toFixed(2)}`;
const L = { ctx: null, vals: null, texts: new Map(), local: new Map(), queue: new Map(), sending: false, drag: -1, timer: null,
            presets: null, err: null, serial: -1, busy: false };

const desc = (ctx) => ctx.state.params?.desc || [];
const shown = (d) => !(d.flags & FLAG.HIDDEN);
const frac = (d, v) => (d.max > d.min ? (v - d.min) / (d.max - d.min) : 0);
function text(d, v) {
  if (d.unit === UNIT.CUSTOM && !d.choices) return L.texts.get(`${d.id}:${v}`) ?? String(v);
  return formatValue(d, v);
}

export default {
  id: "live", title: "Live", icon: "adjustments-horizontal", world: "w-mods",
  available: (state) => !!state.params?.desc?.some(shown) && !["dreamcatcher", "nam"].includes(state.pedal?.firmware?.kind),
  render(ctx) {
    const { esc, icon, state } = ctx, fw = state.pedal?.firmware || {}, ds = desc(ctx);
    if (L.serial !== state.pedalSerial) Object.assign(L, { serial: state.pedalSerial, vals: null, presets: null, err: null }), L.texts.clear(), L.local.clear();
    const chips = [fw.title && fw.version ? `${fw.title} ${fw.version}` : fw.title, fw.meta?.author ? `by ${fw.meta.author}` : null].filter(Boolean);
    const head = ctx.banner("w-mods", "adjustments-horizontal", "Live", "", { chips });
    if (!ds.length) return head + `<section class="card"><p class="muted">This firmware describes no settings.</p></section>`;
    const groups = [];
    for (const d of ds.filter(shown)) { let g = groups.find((x) => x.name === d.group); if (!g) groups.push(g = { name: d.group, items: [] }); g.items.push(d); }
    const control = (d) => {
      const v = L.vals ? L.vals[d.id] : d.def, ro = d.flags & FLAG.READONLY;
      if (ro) return `<div class="dck" data-p="${d.id}"><div class="live-ro" data-v>${esc(L.vals ? text(d, v) : "…")}</div><span class="dck-name">${esc(d.name)}</span></div>`;
      if (d.choices) return `<div class="dck live-choice" data-p="${d.id}"><div class="seg" role="radiogroup" aria-label="${esc(d.name)}">${d.choices.map((c, i) =>
        `<button type="button" role="radio" aria-checked="${i === v}" tabindex="${i === v ? 0 : -1}" data-val="${i}">${esc(c)}</button>`).join("")}</div><span class="dck-name">${esc(d.name)}</span></div>`;
      const f = frac(d, v);
      return `<div class="dck" data-p="${d.id}">
        <div class="dck-knob" role="slider" tabindex="0" aria-label="${esc(d.name)}" aria-valuemin="${d.min}" aria-valuemax="${d.max}" aria-valuenow="${v}"
          aria-valuetext="${esc(text(d, v))}" title="Drag or scroll to turn. Double-click to reset." ${L.vals ? "" : 'aria-disabled="true"'}>
          <svg viewBox="0 0 56 56" aria-hidden="true">
            <circle class="dck-track" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(1)}" transform="rotate(135 28 28)"/>
            <circle class="dck-val" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(f)}" transform="rotate(135 28 28)"/>
            <circle class="dck-cap" cx="28" cy="28" r="14"/>
            <line class="dck-ptr" x1="28" y1="28" x2="28" y2="17" transform="rotate(${(-135 + 270 * f).toFixed(1)} 28 28)"/>
          </svg></div>
        <span class="dck-value" data-v>${L.vals ? esc(text(d, v)) : "…"}</span><span class="dck-name">${esc(d.name)}</span></div>`;
    };
    const cards = groups.map((g) => `<section class="card" style="--fc:var(--world)"><div class="card-head"><h2>${esc(g.name || "Settings")}</h2></div>
      <div class="dck-row live-row">${g.items.map(control).join("")}</div></section>`).join("");
    const p = L.presets;
    const presets = p ? `<section class="card" data-presets><div class="card-head"><h2>${icon("list", 18)} Presets</h2>
        <span class="faint">${p.current >= 0 ? `P${p.current + 1} loaded${p.dirty ? ", changed" : ""}` : "none loaded"}</span></div>
      <div class="list">${p.names.map((n, i) => `<div class="item ${i === p.current ? "sel" : ""}"><span class="n">P${i + 1}</span>
        <span class="main">${p.used[i] ? `<input class="live-name" data-name="${i}" maxlength="12" value="${esc(n)}" aria-label="Name of preset ${i + 1}" placeholder="(no name)" spellcheck="false">` : '<span class="name empty">empty</span>'}</span>
        ${p.used[i] ? `<button class="btn small" data-load="${i}">Load</button>` : ""}
        <button class="btn small ${p.used[i] ? "ghost" : ""}" data-save="${i}" title="Save the current sound here">${icon("device-floppy", 15)} Save</button></div>`).join("")}</div></section>` : "";
    return head + `<div class="note bad" data-live-err ${L.err ? "" : "hidden"}><span>${esc(L.err || "")}</span></div>
      <div class="cols w-mods" style="--n:2;--fc:var(--world)"><div class="stack" style="gap:var(--gap)">${cards}</div><div class="stack" style="gap:var(--gap)">${presets}
      <p class="faint" style="font-size:12.5px">From the firmware's own description: what it calls its settings, their ranges and units. Changes play at once; the pedal's own controls show up here within a moment.</p></div></div>`;
  },
  mount(root, ctx) {
    L.ctx = ctx;
    root.querySelectorAll("[data-p]").forEach((box) => wire(root, box));
    root.querySelectorAll("[data-load]").forEach((b) => b.onclick = () => presetAction(ctx, "Loading", (l) => loadPreset(l, +b.dataset.load), `Loaded P${+b.dataset.load + 1}`));
    root.querySelectorAll("[data-save]").forEach((b) => b.onclick = async () => {
      const n = +b.dataset.save;
      if (L.presets?.used[n] && n !== L.presets.current && !(await ctx.confirm(`Save into P${n + 1}?`, `P${n + 1} holds a sound; it's replaced by the current one.`, "Save"))) return;
      presetAction(ctx, "Saving", (l) => savePreset(l, n), `Saved into P${n + 1}`);
    });
    root.querySelectorAll("[data-name]").forEach((inp) => inp.onchange = () => presetAction(ctx, "Renaming", (l) => renamePreset(l, +inp.dataset.name, inp.value.trim()), "Renamed"));
    if (!L.timer) L.timer = setInterval(() => { if (!document.querySelector("[data-p]")) { clearInterval(L.timer); L.timer = null; return; } read(); }, POLL_MS);
    read(true);
  },
};

async function presetAction(ctx, what, fn, done) {
  while (L.sending || L.queue.size) await new Promise((r) => setTimeout(r, 30));     // the last changes first
  const ok = await ctx.linkQuiet(fn).catch(() => false);
  if (ok) ctx.toast(done); else showError(`${what} didn't work on the pedal.`);
  L.local.clear();
  await read(true, true);
}

function showError(msg) {
  L.err = msg;
  const n = document.querySelector("[data-live-err]");
  if (n) { n.hidden = !msg; n.querySelector("span").textContent = msg || ""; }
}

// pull custom texts for the values on screen (GP5_U_CUSTOM: the firmware formats them)
async function fetchTexts(ds) {
  const want = ds.filter((d) => shown(d) && d.unit === UNIT.CUSTOM && !d.choices && L.vals && !L.texts.has(`${d.id}:${L.vals[d.id]}`));
  if (!want.length) return false;
  await L.ctx.linkQuiet(async (link) => { for (const d of want) { const t = await valueText(link, d.id, L.vals[d.id]); L.texts.set(`${d.id}:${L.vals[d.id]}`, t ?? String(L.vals[d.id])); } }).catch(() => null);
  if (L.texts.size > 2000) L.texts.clear();
  return true;
}

function refresh() {
  const root = document.querySelector("main") || document;
  for (const d of desc(L.ctx)) {
    const box = root.querySelector(`[data-p="${d.id}"]`); if (!box || !L.vals) continue;
    const v = L.vals[d.id], t = text(d, v);
    const vEl = box.querySelector("[data-v]"); if (vEl) vEl.textContent = t;
    const knob = box.querySelector(".dck-knob");
    if (knob) {
      const f = frac(d, v);
      box.querySelector(".dck-val").setAttribute("stroke-dasharray", arc(f));
      box.querySelector(".dck-ptr").setAttribute("transform", `rotate(${(-135 + 270 * f).toFixed(1)} 28 28)`);
      knob.setAttribute("aria-valuenow", v); knob.setAttribute("aria-valuetext", t); knob.removeAttribute("aria-disabled");
    }
    box.querySelectorAll("[data-val]").forEach((b) => { const on = +b.dataset.val === v; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
  }
}

async function read(force = false, rerender = false) {
  const ctx = L.ctx, ds = desc(ctx);
  if (!ctx || !ds.length || ctx.state.busy || (!force && (L.sending || L.queue.size || L.drag >= 0))) return;
  const got = await ctx.linkQuiet(async (link) => ({ vals: await readValues(link, ds.length), presets: await readPresets(link) })).catch(() => null);
  if (!got?.vals) return;
  const first = !L.vals, now = Date.now();
  if (first) L.vals = got.vals.slice();
  else got.vals.forEach((v, i) => { if (now - (L.local.get(i) || 0) >= HOLD_MS) L.vals[i] = v; });
  const presetsChanged = JSON.stringify(got.presets) !== JSON.stringify(L.presets);
  L.presets = got.presets;
  const textsNew = await fetchTexts(ds);
  if (first || rerender || presetsChanged) {
    if (!document.activeElement?.matches?.("[data-name]")) { ctx.render(); return; }
  }
  if (textsNew || !first) refresh();
}

async function flush() {
  L.sending = true;
  try {
    while (L.queue.size) {
      const [id, v] = L.queue.entries().next().value;
      L.queue.delete(id);
      const ok = await L.ctx.linkQuiet((link) => setValue(link, id, v));
      showError(ok ? null : "The pedal didn't take a change.");
    }
    await fetchTexts(desc(L.ctx)); refresh();
  } catch (e) { showError(`Couldn't reach the pedal: ${e.message}`); }
  finally { L.sending = false; }
}
function set(d, x) {
  x = Math.max(d.min, Math.min(d.max, Math.round(x)));
  if (!L.vals || x === L.vals[d.id]) return;
  L.vals[d.id] = x; L.local.set(d.id, Date.now());
  refresh();
  L.queue.set(d.id, x);
  if (!L.sending) flush();
}

function wire(root, box) {
  const d = desc(L.ctx).find((x) => x.id === +box.dataset.p);
  if (!d || d.flags & FLAG.READONLY) return;
  box.querySelectorAll("[data-val]").forEach((b) => {
    b.onclick = () => set(d, +b.dataset.val);
    b.onkeydown = (e) => {
      const n = d.choices.length, i = +b.dataset.val, to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault(); const j = (to + n) % n; set(d, j); box.querySelector(`[data-val="${j}"]`)?.focus();
    };
  });
  const knob = box.querySelector(".dck-knob");
  if (!knob) return;
  const range = d.max - d.min, big = Math.max(1, Math.round(range / 16)), wheel = range > 100 ? Math.max(1, Math.round(range / 100)) : 1;
  let y0 = 0, x0 = 0, pid = null;
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !L.vals) return;
    e.preventDefault(); knob.focus();
    try { knob.setPointerCapture(e.pointerId); } catch { /* keep turning without capture */ }
    pid = e.pointerId; L.drag = d.id; y0 = e.clientY; x0 = L.vals[d.id]; knob.classList.add("turning");
  });
  knob.addEventListener("pointermove", (e) => {
    if (L.drag !== d.id || e.pointerId !== pid) return;
    set(d, x0 + ((y0 - e.clientY) * (e.shiftKey ? 0.25 : 1) / 200) * Math.max(range, 8));
  });
  const up = (e) => { if (e.pointerId !== pid) return; try { knob.releasePointerCapture(e.pointerId); } catch { /* not captured */ } pid = null; L.drag = -1; knob.classList.remove("turning"); };
  knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", up);
  knob.addEventListener("wheel", (e) => { if (!L.vals) return; e.preventDefault(); set(d, L.vals[d.id] + (e.deltaY < 0 ? wheel : -wheel)); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    if (!L.vals) return;
    const x = L.vals[d.id], to = { ArrowUp: x + 1, ArrowRight: x + 1, ArrowDown: x - 1, ArrowLeft: x - 1, PageUp: x + big, PageDown: x - big, Home: d.min, End: d.max }[e.key];
    if (to === undefined) return;
    e.preventDefault(); set(d, to);
  });
  knob.addEventListener("dblclick", () => set(d, d.def));
}
