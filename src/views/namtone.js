// NAM Loader's gate and EQ for the tone playing (NAM Loader 1.2: live settings 2..5, kept by the pedal per tone).
// Four knobs that change the sound as you turn them; what's changed on the pedal's own TONE page (hold PARA) shows up
// here within a moment. Rendered once, then updated in place (a re-render would drop the knob being turned).
import { paramSet, paramsRead } from "../lib/device.js";

const ID0 = 2;                                         // gate, bass, mid, treble
export const TONE_KNOBS = [
  { name: "Gate", max: 61, def: 0, text: (v) => (v === 0 ? "Off" : `−${91 - v} dB`), spoken: (v) => (v === 0 ? "off" : `minus ${91 - v} decibels`) },
  { name: "Bass", max: 24, def: 12, text: (v) => eqText(v), spoken: (v) => eqSpoken(v) },
  { name: "Mid", max: 24, def: 12, text: (v) => eqText(v), spoken: (v) => eqSpoken(v) },
  { name: "Treble", max: 24, def: 12, text: (v) => eqText(v), spoken: (v) => eqSpoken(v) },
];
function eqText(v) { const d = v - 12; return d === 0 ? "0 dB" : `${d > 0 ? "+" : "−"}${Math.abs(d)} dB`; }
function eqSpoken(v) { const d = v - 12; return d === 0 ? "flat" : `${d > 0 ? "plus" : "minus"} ${Math.abs(d)} decibels`; }

const R = 21, CIRC = 2 * Math.PI * R, SWEEP = 0.75, HOLD_MS = 1500, POLL_MS = 1500;
const arc = (f) => `${(CIRC * SWEEP * f).toFixed(2)} ${CIRC.toFixed(2)}`;
const T = { vals: null, supported: null, ctx: null, local: [0, 0, 0, 0], queue: new Map(), sending: false, drag: -1, timer: null, err: null };

/** the card (empty for a NAM Loader without the tone section) */
export function renderTone(ctx) {
  if (T.supported === false) return "";
  const { esc, icon, state } = ctx, cur = state.nam?.bank.find((s) => s && s.crc === state.nam.playing);
  const who = cur ? `“${esc(cur.name)}”` : "the capture playing";
  const knobs = TONE_KNOBS.map((k, i) => {
    const v = T.vals ? T.vals[i] : k.def, f = v / k.max;
    return `<div class="dck" data-tk="${i}">
      <div class="dck-knob" role="slider" tabindex="0" aria-label="${k.name}" aria-valuemin="0" aria-valuemax="${k.max}" aria-valuenow="${v}"
        aria-valuetext="${k.spoken(v)}" title="Drag or scroll to turn. Double-click to reset." ${T.vals ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 56 56" aria-hidden="true">
          <circle class="dck-track" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(1)}" transform="rotate(135 28 28)"/>
          <circle class="dck-val" cx="28" cy="28" r="${R}" stroke-dasharray="${arc(f)}" transform="rotate(135 28 28)"/>
          <circle class="dck-cap" cx="28" cy="28" r="14"/>
          <line class="dck-ptr" x1="28" y1="28" x2="28" y2="17" transform="rotate(${(-135 + 270 * f).toFixed(1)} 28 28)"/>
        </svg></div>
      <span class="dck-value" data-v>${T.vals ? k.text(v) : "…"}</span><span class="dck-name">${k.name}</span></div>`;
  }).join("");
  return `<section class="card" data-namtone style="--fc:var(--world)"><div class="card-head"><h2>${icon("adjustments-horizontal", 18)} Gate and EQ</h2></div>
    <p class="muted" style="margin:0 0 10px;font-size:13px">For ${who}, kept with it on the pedal. On the pedal: hold PARA.</p>
    <div class="dck-row" style="grid-template-columns:repeat(4,minmax(0,1fr))">${knobs}</div>
    <div class="note bad" data-tone-err ${T.err ? "" : "hidden"}><span>${esc(T.err || "")}</span></div></section>`;
}

function refresh(root) {
  if (!T.vals) return;
  root.querySelectorAll("[data-tk]").forEach((box) => {
    const i = +box.dataset.tk, k = TONE_KNOBS[i], v = T.vals[i], f = v / k.max, knob = box.querySelector(".dck-knob");
    box.querySelector(".dck-val").setAttribute("stroke-dasharray", arc(f));
    box.querySelector(".dck-ptr").setAttribute("transform", `rotate(${(-135 + 270 * f).toFixed(1)} 28 28)`);
    box.querySelector("[data-v]").textContent = k.text(v);
    knob.setAttribute("aria-valuenow", v); knob.setAttribute("aria-valuetext", k.spoken(v)); knob.removeAttribute("aria-disabled");
  });
}
function showError(root, msg) {
  T.err = msg;
  const n = root?.querySelector("[data-tone-err]");
  if (n) { n.hidden = !msg; n.querySelector("span").textContent = msg || ""; }
}

async function flush(root) {
  T.sending = true;
  try {
    while (T.queue.size) {
      const [i, v] = T.queue.entries().next().value;
      T.queue.delete(i);
      const ok = await T.ctx.linkQuiet((link) => paramSet(link, ID0 + i, v));
      showError(root, ok ? null : "The pedal didn't take a change. Is it still running NAM Loader?");
    }
  } catch (e) { showError(root, `Couldn't reach the pedal: ${e.message}`); }
  finally { T.sending = false; }
}
function set(root, i, x) {
  const k = TONE_KNOBS[i];
  x = Math.max(0, Math.min(k.max, Math.round(x)));
  if (!T.vals || x === T.vals[i]) return;
  T.vals[i] = x; T.local[i] = Date.now();
  refresh(root);
  T.queue.set(i, x);
  if (!T.sending) flush(root);
}

async function read() {
  const ctx = T.ctx, root = document.querySelector("[data-namtone]");
  if (!ctx || ctx.state.busy || T.sending || T.queue.size || T.drag >= 0) return;
  if (ctx.state.pedal?.firmware?.kind !== "nam") return;
  const got = await ctx.linkQuiet((link) => paramsRead(link, ID0, 4)).catch(() => null);
  if (!got) return;
  if (got.length < 4) {                                  // a NAM Loader before 1.2: no tone section
    if (T.supported !== false) { T.supported = false; ctx.render(); }
    return;
  }
  const first = !T.vals, now = Date.now();
  if (first) T.vals = got.slice();
  else got.forEach((v, i) => { if (now - T.local[i] >= HOLD_MS) T.vals[i] = v; });   // just turned here: the pedal catches up
  if (T.supported !== true) { T.supported = true; ctx.render(); return; }
  if (root) refresh(root);
}

function wire(root, box) {
  const i = +box.dataset.tk, k = TONE_KNOBS[i], knob = box.querySelector(".dck-knob");
  let y0 = 0, x0 = 0, pid = null;
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !T.vals) return;
    e.preventDefault(); knob.focus();
    try { knob.setPointerCapture(e.pointerId); } catch { /* keep turning without capture */ }
    pid = e.pointerId; T.drag = i; y0 = e.clientY; x0 = T.vals[i]; knob.classList.add("turning");
  });
  knob.addEventListener("pointermove", (e) => {
    if (T.drag !== i || e.pointerId !== pid) return;
    set(root, i, x0 + ((y0 - e.clientY) * (e.shiftKey ? 0.25 : 1) / 200) * k.max);
  });
  const up = (e) => {
    if (e.pointerId !== pid) return;
    try { knob.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    pid = null; T.drag = -1; knob.classList.remove("turning");
  };
  knob.addEventListener("pointerup", up); knob.addEventListener("pointercancel", up);
  knob.addEventListener("wheel", (e) => { if (!T.vals) return; e.preventDefault(); set(root, i, T.vals[i] + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    if (!T.vals) return;
    const x = T.vals[i], to = { ArrowUp: x + 1, ArrowRight: x + 1, ArrowDown: x - 1, ArrowLeft: x - 1, PageUp: x + 6, PageDown: x - 6, Home: 0, End: k.max }[e.key];
    if (to === undefined) return;
    e.preventDefault(); set(root, i, to);
  });
  knob.addEventListener("dblclick", () => set(root, i, k.def));
}

export function mountTone(root, ctx) {
  T.ctx = ctx;
  const card = root.querySelector("[data-namtone]");
  if (card) card.querySelectorAll("[data-tk]").forEach((box) => wire(card, box));
  if (!T.timer) {
    T.timer = setInterval(() => {
      if (!document.querySelector("[data-namtone]") && T.supported !== null) { clearInterval(T.timer); T.timer = null; return; }
      read();
    }, POLL_MS);
  }
  read();
}
/** another pedal or firmware: start over */
export function resetTone() { Object.assign(T, { vals: null, supported: null, local: [0, 0, 0, 0], err: null }); T.queue.clear(); }
