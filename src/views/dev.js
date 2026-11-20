// Developer: what the firmware's gp5_log lines say on both processors, and how busy both processors are (OpenGP5
// platform 0.7 and later: 7E 18, 7E 14; lib/devtools.js). The same as `gp5_link.py log -f` and `status`.
import { readLog, readStatus, share } from "../lib/devtools.js";
import { MODE_OPEN } from "../lib/device.js";

/* platform version at least want ("0.7.0") */
const atLeast = (v, want) => { const a = String(v || "0").split(".").map(Number), b = want.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; return true; };

const LOG_MS = 700, STATUS_MS = 2000, MAX_LINES = 3000;
const D = { serial: -1, lines: [], partial: "", pos: 0, status: null, follow: true, err: null, timer: null, lastStatus: 0, lost: 0, ctx: null };

const pct = (x) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)} %`;
const kb = (n) => (n >= 10240 ? `${Math.round(n / 1024)} KB` : `${(n / 1024).toFixed(1)} KB`);
function bar(label, f, detail, hint = "") {
  const cls = f > 1 ? "bad" : f > 0.85 ? "warn" : "";
  return `<div class="dev-bar ${cls}" title="${hint}"><div class="dev-bar-top"><span>${label}</span><span class="mono">${detail}</span></div>
    <div class="dev-track"><div class="dev-fill" style="width:${Math.min(100, 100 * f).toFixed(1)}%"></div></div></div>`;
}

function statusHtml(ctx) {
  const s = D.status;
  if (!s) return `<p class="muted">${D.err ? ctx.esc(D.err) : "Reading…"}</p>`;
  const c = s.ctl, d = s.dsp;
  return `<div class="stack" style="gap:12px">
      <h3 class="sub-head" style="margin:0">Control processor</h3>
      ${bar("Audio-link handler, last", share(c.linkLast, c.block), pct(share(c.linkLast, c.block)), "on_block, in its interrupt: the share of an audio block it took")}
      ${bar("Audio-link handler, worst", share(c.linkWorst, c.block), pct(share(c.linkWorst, c.block)))}
      ${bar("Main loop, longest pass", share(c.loopWorst, c.block), `${pct(share(c.loopWorst, c.block))} of a block`, "your callbacks, drawing, USB: long passes make the controls sluggish, never the sound")}
      ${bar("RAM", c.ramTotal ? c.ramUsed / c.ramTotal : 0, `${kb(c.ramUsed)} of ${kb(c.ramTotal)}`)}
      <h3 class="sub-head" style="margin:4px 0 0">DSP</h3>
      ${d ? `${bar("Audio block, last", share(d.last, d.block), pct(share(d.last, d.block)))}
      ${bar("Audio block, worst", share(d.worst, d.block), pct(share(d.worst, d.block)))}
      <p class="${d.late ? "warn-text" : "faint"}" style="font-size:13px">${d.late ? `${d.late} late blocks: each one is an audible glitch.` : "No late blocks."}</p>
      ${bar("Variables", d.varsTotal ? d.varsUsed / d.varsTotal : 0, `${kb(d.varsUsed)} of ${kb(d.varsTotal)}`)}
      ${bar("GP5_LARGE buffers", d.largeTotal ? d.largeUsed / d.largeTotal : 0, `${kb(d.largeUsed)} of ${kb(d.largeTotal)}`)}`
        : `<p class="warn-text" style="font-size:13px">The DSP did not answer.</p>`}
    </div>`;
}

function logHtml(ctx) {
  const lines = D.lines.slice(-400);
  return lines.map((l) => `<div class="${/^\[[ \d.]+\] dsp: /.test(l) ? "dsp" : ""}">${ctx.esc(l)}</div>`).join("") || `<div class="faint">No lines yet. ${D.err ? ctx.esc(D.err) : "gp5_log() lines show up here."}</div>`;
}

async function poll(ctx) {
  if (!document.querySelector("[data-devlog]")) { clearInterval(D.timer); D.timer = null; return; }
  const now = Date.now(), wantStatus = now - D.lastStatus > STATUS_MS;
  const got = await ctx.linkQuiet(async (link) => ({ log: await readLog(link, D.pos), status: wantStatus ? await readStatus(link) : undefined })).catch((e) => ({ error: e.message }));
  if (got.error) { D.err = got.error; return; }
  if (got.log) {
    D.pos = got.log.next; D.lost += got.log.lost;
    const parts = (D.partial + got.log.text).split("\n");
    D.partial = parts.pop();
    if (got.log.lost) D.lines.push(`… ${got.log.lost} bytes of log were overwritten before Launchpad read them`);
    D.lines.push(...parts.filter((x) => x.length));
    if (D.lines.length > MAX_LINES) D.lines.splice(0, D.lines.length - MAX_LINES);
    const box = document.querySelector("[data-devlog]");
    if (box && D.follow) { box.innerHTML = logHtml(ctx); box.scrollTop = box.scrollHeight; }
  } else if (got.log === null) D.err = "This firmware has no log (built before OpenGP5 0.7).";
  if (got.status !== undefined) {
    D.lastStatus = now; D.status = got.status;
    const s = document.querySelector("[data-devstatus]");
    if (s) s.innerHTML = statusHtml(ctx);
  }
}

export default {
  id: "dev", title: "Developer", icon: "gauge", world: "w-mods",
  available: (state) => state.pedal?.mode === MODE_OPEN && atLeast(state.pedal?.firmware?.platform, "0.7.0"),
  render(ctx) {
    const { icon, state } = ctx, fw = state.pedal?.firmware || {};
    if (D.serial !== state.pedalSerial) Object.assign(D, { serial: state.pedalSerial, lines: [], partial: "", pos: 0, status: null, err: null, lost: 0, lastStatus: 0 });
    const chips = [fw.title && fw.version ? `${fw.title} ${fw.version}` : fw.title, fw.platform ? `OpenGP5 ${fw.platform}` : null].filter(Boolean);
    return ctx.banner("w-mods", "gauge", "Developer", "", { chips }) + `
      <div class="cols w-mods" style="--n:2;--fc:var(--world)">
        <section class="card"><div class="card-head"><h2>${icon("list", 18)} Log</h2>
            <div class="row" style="gap:6px">
              <button class="btn small ${D.follow ? "" : "primary"}" data-act="follow" aria-pressed="${!D.follow}">${D.follow ? "Pause" : "Follow"}</button>
              <button class="btn small ghost" data-act="copy">${icon("copy", 15)} Copy</button>
              <button class="btn small ghost" data-act="save">${icon("device-floppy", 15)} Save</button>
              <button class="btn small ghost" data-act="clear">Clear</button></div></div>
          <div class="log dev-log" data-devlog role="log" aria-live="off" tabindex="0" aria-label="The pedal's log">${logHtml(ctx)}</div>
          <p class="faint" style="font-size:12.5px;margin-top:8px">Lines from <code>gp5_log()</code> on both processors, the DSP's marked "dsp:". The pedal keeps the last 4 KB.</p>
        </section>
        <section class="card"><div class="card-head"><h2>${icon("gauge", 18)} Load and memory</h2>
            <button class="btn small ghost" data-act="reset" title="Start the worst values again">Reset worst</button></div>
          <div data-devstatus>${statusHtml(ctx)}</div>
          <p class="faint" style="font-size:12.5px;margin-top:10px">Keep the worst under about 85 % of a block while playing your heaviest settings.</p>
        </section>
      </div>`;
  },
  mount(root, ctx) {
    D.ctx = ctx;
    root.querySelector('[data-act="follow"]').onclick = () => { D.follow = !D.follow; ctx.render(); };
    root.querySelector('[data-act="clear"]').onclick = () => { D.lines = []; D.partial = ""; ctx.render(); };
    root.querySelector('[data-act="copy"]').onclick = async () => {
      const t = D.lines.join("\n");
      try { if (window.launchpad?.copyText) await window.launchpad.copyText(t); else await navigator.clipboard.writeText(t); ctx.toast("Log copied"); }
      catch { ctx.toast("Couldn't copy the log"); }
    };
    root.querySelector('[data-act="save"]').onclick = async () => {
      const r = await ctx.saveFile("Save the log", `gp5-log-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`,
        [{ name: "Text", extensions: ["txt"] }], new TextEncoder().encode(D.lines.join("\n") + "\n"));
      if (r) ctx.toast(`Saved ${r.name}`);
    };
    root.querySelector('[data-act="reset"]').onclick = async () => {
      const s = await ctx.linkQuiet((link) => readStatus(link, true)).catch(() => null);
      if (s) { D.status = s; D.lastStatus = Date.now(); const el = document.querySelector("[data-devstatus]"); if (el) el.innerHTML = statusHtml(ctx); }
    };
    const box = root.querySelector("[data-devlog]");
    box.scrollTop = box.scrollHeight;
    if (!D.timer) { D.timer = setInterval(() => poll(ctx), LOG_MS); poll(ctx); }
  },
};
