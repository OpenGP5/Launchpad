// The pedal, drawn: the right-hand panel shows the GP-5 with its screen as the firmware draws it (NAM player:
// the capture playing; Dreamcatcher: the preset; stock: Valeton's own screen; update mode), its volume knob where
// the pedal reports it, and the facts about it.
import { MODE_OPEN, MODE_STOCK, MODE_LOADER } from "../lib/device.js";

// LED ring colour per firmware; Valeton's own is the blue of the real pedal.
const LED = { nam: "#ffc72c", dreamcatcher: "#b07cff", tuner: "#7fe0b8", opengp5: "#7fe0b8", stock: "#1f9bff", off: "off" };

// The GP-5, drawn from a vector of the real pedal (valeton-gp5-simplified-v2.svg, Valeton logo removed):
// jacks, enclosure, USB / 9 V labels, VOL and PARA knobs, the screen, the GP-5 mark, the foot switch inside its
// LED ring. All in the original's coordinates (the content is shifted by -56.25, -39.815 into a 532 x 1161 box).
// knob: the volume knob's position 0..1 when the pedal reports it (null: drawn where the original has it).
// stock: { n, name } draws Valeton's own screen (preset number on blue, name below the status symbol).
const T = "font-family:var(--font-ui),Helvetica,Arial,sans-serif;font-weight:600;letter-spacing:0.06em;fill:#dfe3e6";
// The volume knob's pointer, in degrees from 12 o'clock: -150 (fully down) .. +150 (fully up); unknown: where
// the reference photos show it.
export const knobAngle = (v) => (v == null ? -50 : -150 + 300 * Math.min(1, Math.max(0, v)));

// A jack on the side: dark mount, chrome nut and washer (chrome = a light-to-dark gradient).
let drawn = 0;
const jack = (tf, u) => `<g transform="${tf}"><rect x="-20" y="-54" width="21" height="108" rx="2" fill="#1d2126"/>
    <path transform="translate(2 0)" d="M-16,-63L-24,-63L-33,-48L-33,48L-24,63L-16,63L-12,48L-12,-48Z" fill="url(#lp-chrome-v-${u})" stroke="#2a2f35" stroke-width="1.5"/>
    <path transform="translate(1 0)" d="M-9,-72C-5.689,-72 -3,-69.311 -3,-66L-3,66C-3,69.311 -5.689,72 -9,72C-12.311,72 -15,69.311 -15,66L-15,-66C-15,-69.311 -12.311,-72 -9,-72Z" fill="url(#lp-chrome-v-${u})" stroke="#2a2f35" stroke-width="1.5"/></g>`;

// A knob as on the real GP-5: matte black, a finely knurled skirt (48 ridges), a flat top with a faint bevel, and
// for VOL a crisp white indicator line from the centre to the edge (the group .vol-ind turns it). No shine.
function knob(cx, cy, pointer, angle, u) {
  const ridges = Array.from({ length: 48 }, (_, i) => {
    const a = (i * 7.5) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return `<path d="M${(82 * c).toFixed(1)},${(82 * s).toFixed(1)}L${(94 * c).toFixed(1)},${(94 * s).toFixed(1)}"/>`;
  }).join("");
  return `<g transform="translate(${cx} ${cy})">
    <circle r="97" cy="5" fill="#000" opacity="0.3" filter="url(#lp-blur-${u})"/>
    <circle r="95" fill="#121316"/>
    <g stroke="#26282d" stroke-width="3.2" stroke-linecap="round">${ridges}</g>
    <circle r="80" fill="#1a1b1f"/>
    <circle r="80" fill="url(#lp-knob-top-${u})"/>
    <circle r="79" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="2"/>
    ${pointer ? `<g class="vol-ind" transform="rotate(${angle.toFixed(1)})"><path d="M0,-74L0,-30" stroke="#f2f4f5" stroke-width="8" stroke-linecap="round"/></g>` : ""}
    <circle r="95" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="2"/></g>`;
}

// The GP-5, drawn after a vector of the real pedal (valeton-gp5-simplified-v2.svg, Valeton logo left out)
// and photos of it: gunmetal enclosure with a soft sheen, faceted black knobs, chrome jacks and foot switch, the
// translucent LED ring that glows in the firmware's colour. In the vector's coordinates (shifted by -56.25, -39.815
// into a 532 x 1161 box). knob: the volume knob 0..1 when the pedal reports it (null: as in the photos).
// stock: { n, name } draws Valeton's own screen.
export function pedalSvg(led, { knob: kv = null, stock = null } = {}) {
  const on = led !== LED.off, u = ++drawn;   // ids unique per drawing (gradients are looked up by id)
  return `<svg viewBox="0 0 532 1161" role="img" aria-label="The GP-5"><defs>
      <linearGradient id="lp-body-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d636a"/><stop offset="0.45" stop-color="#4b5056"/><stop offset="1" stop-color="#3e4247"/></linearGradient>
      <linearGradient id="lp-sheen-${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient>
      <linearGradient id="lp-chrome-v-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f7"/><stop offset="0.45" stop-color="#a9b1b6"/><stop offset="0.55" stop-color="#d9dee1"/><stop offset="1" stop-color="#7d868c"/></linearGradient>
      <linearGradient id="lp-chrome-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f8f9"/><stop offset="0.5" stop-color="#b5bcc1"/><stop offset="1" stop-color="#eef1f2"/></linearGradient>
      <radialGradient id="lp-knob-top-${u}" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></radialGradient>
      <radialGradient id="lp-button-${u}" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#6a6261"/><stop offset="1" stop-color="#352f30"/></radialGradient>
      <radialGradient id="lp-ring-${u}" cx="0.5" cy="0.5" r="0.5"><stop offset="0.74" stop-color="${on ? led : "#9aa3a9"}" stop-opacity="${on ? 0.25 : 0.08}"/><stop offset="0.88" stop-color="${on ? led : "#c9d0d4"}" stop-opacity="${on ? 0.95 : 0.3}"/><stop offset="1" stop-color="${on ? led : "#9aa3a9"}" stop-opacity="${on ? 0.55 : 0.18}"/></radialGradient>
      <filter id="lp-blur-${u}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
      <filter id="lp-glow-${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    </defs><g transform="translate(-56.25 -39.815)">
    ${jack("translate(88 642)", u)}${jack("matrix(-1 0 0 1 556 472)", u)}
    <path d="M154,46L487,46C530,46 556,77 556,123L557,1112C557,1165 537,1194 502,1194L146,1194C109,1194 88,1164 88,1112L88,124C88,77 114,46 154,46Z" fill="url(#lp-body-${u})" stroke="#2c3036" stroke-width="3"/>
    <path d="M154,46L487,46C530,46 556,77 556,123L557,1112C557,1165 537,1194 502,1194L146,1194C109,1194 88,1164 88,1112L88,124C88,77 114,46 154,46Z" fill="url(#lp-sheen-${u})"/>
    <path d="M156,50L485,50C525,50 551,79 551,123" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="2"/>
    <text x="290" y="94" style="${T};font-size:28px">USB</text><text x="244" y="125" style="${T};font-size:27px">9V</text>
    <g fill="none" stroke="#dfe3e6" stroke-width="2.5" stroke-linecap="round"><circle cx="312" cy="115" r="10"/><path d="M307,115L317,115M312,110L312,120M322,115L335,115M353,106C351.148,104.699 348.939,104 346.675,104C340.641,104 335.675,108.966 335.675,115C335.675,121.034 340.641,126 346.675,126C348.939,126 351.148,125.301 353,124M347,115L370,115"/><circle cx="380" cy="115" r="10"/><path d="M375,115L385,115"/></g>
    <circle cx="347" cy="115" r="3" fill="#dfe3e6"/>
    ${knob(209, 221, true, knobAngle(kv), u)}${knob(433, 219, false, 0, u)}
    <text x="209" y="367" text-anchor="middle" style="${T};font-size:36px">VOL</text><text x="433" y="367" text-anchor="middle" style="${T};font-size:36px">PARA</text>
    <text transform="matrix(0 1 -1 0 521 456)" style="${T};font-size:24px">IN</text>
    <text transform="matrix(0 1 -1 0 106 550)" style="${T};font-size:24px">OUT/PHONES</text>
    <path d="M464,469C479.454,469 492,481.546 492,497L492,642C492,657.454 479.454,670 464,670L178,670C162.546,670 150,657.454 150,642L150,497C150,481.546 162.546,469 178,469Z" fill="#050709" stroke="#2a2e33" stroke-width="2"/>
    ${stock ? stockScreen(stock, u) : `<rect x="176" y="495" width="294" height="149" rx="7" fill="#02080d"/>`}
    <g fill="none" stroke="#dfe3e6" stroke-width="3.2" opacity="0.9">
      <path d="M251,690L202,690C187.333,690 180,697.667 180,713L180,733C180,747.667 187.333,755 202,755L251,755L251,719L221,719L221,731L234,731L234,742L205,742C198.333,742 195,738.333 195,731L195,714C195,706.667 198.333,703 205,703L251,703L251,690Z"/>
      <path d="M261,755L261,690L309,690C325.667,690 334,697.333 334,712C334,727.333 325.667,735 309,735L277,735L277,755L261,755ZM277,703L277,722L307,722C314.333,722 318,718.667 318,712C318,706 314.333,703 307,703L277,703Z"/>
      <rect x="340" y="716" width="43" height="15"/>
      <path d="M461,690L390,690L390,727L435,727C443,727 447,729.667 447,735C447,739.667 443,742 435,742L390,742L390,755L437,755C455.667,755 465,748.333 465,735C465,721 456.667,714 440,714L406,714L406,703L461,703L461,690Z"/></g>
    ${on ? `<circle cx="320" cy="979" r="150" fill="${led}" opacity="0.35" filter="url(#lp-glow-${u})"/>` : ""}
    <circle cx="320" cy="979" r="149" fill="url(#lp-ring-${u})" stroke="${on ? led : "#2f343a"}" stroke-opacity="${on ? 0.7 : 1}" stroke-width="3"/>
    <circle cx="320" cy="979" r="113" fill="url(#lp-chrome-${u})" stroke="#6f777d" stroke-width="2"/>
    ${[45, 135, 225, 315].map((a) => `<rect x="-11" y="-112" width="22" height="34" rx="2" fill="#3a3f45" transform="translate(320 979) rotate(${a})"/>`).join("")}
    <circle cx="320" cy="979" r="80" fill="url(#lp-chrome-${u})" stroke="#8a9298" stroke-width="2"/>
    <circle cx="320" cy="979" r="62" fill="url(#lp-button-${u})" stroke="#e9edef" stroke-width="4"/>
  </g></svg>`;
}

// Valeton's screen as the stock firmware draws it: the preset number big on the blue panel, the Bluetooth status
// symbol top right, the name below it in two lines of five (as the pedal splits it).
function stockScreen({ n, name }, u = 0) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const num = String(n ?? 0).padStart(2, "0"), nm = String(name ?? "");
  const line = (t, y) => t ? `<text x="356" y="${y}" textLength="${(22.1 * t.length - 7).toFixed(1)}" lengthAdjust="spacingAndGlyphs" style="font:600 31px Helvetica,Arial,sans-serif;fill:#e8fbff">${esc(t)}</text>` : "";
  return `<clipPath id="lp-scr-${u}"><rect x="176" y="495" width="294" height="149" rx="7"/></clipPath>
    <g clip-path="url(#lp-scr-${u})"><rect x="176" y="495" width="294" height="149" fill="#001326"/>
      <rect x="176" y="495" width="171" height="149" fill="#008de0"/><rect x="350" y="495" width="120" height="60" fill="#005d99"/>
      <path d="M348.5,495L348.5,644M350,557L470,557" stroke="#002e58" stroke-width="3"/></g>
    ${[...num].map((d, i) => `<text x="${218 + 86 * i}" y="619" text-anchor="middle" style="font:700 138px 'Helvetica Neue',Helvetica,Arial,sans-serif;fill:#e0ffff">${d}</text>`).join("")}
    <g fill="none" stroke="#dcffff" stroke-width="5" stroke-linecap="round"><path d="M379,512C375,520 374.667,528.333 378,537M392,519C390.667,523 390.667,526.667 392,530M429,519C430.333,523 430.333,526.667 429,530M443,512C447,520 447.333,528.333 444,537"/></g>
    <circle cx="410" cy="525" r="2.8" fill="#dcffff"/>
    ${line(nm.slice(0, 5), 596)}${line(nm.slice(5, 10), 633)}`;
}

// what the pedal's own screen shows, roughly (HTML on top of the drawing)
function screen(ctx) {
  const { state, esc } = ctx, p = state.pedal, fw = p?.firmware?.kind;
  if (!p) return "";
  if (p.mode === MODE_LOADER) return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:3cqw;text-align:center">
      <svg viewBox="0 0 24 24" style="width:18cqw;height:18cqw"><path d="M12 3 2 21h20L12 3z" fill="#e5484d"/><rect x="11" y="9" width="2" height="6" rx="1" fill="#fff"/><circle cx="12" cy="17.6" r="1.1" fill="#fff"/></svg>
      <div style="font:600 6.5cqw/1.25 var(--font-ui);color:#f4f2ec">When updating<br>Please don't shut down!</div></div>`;
  if (p.mode === MODE_STOCK) return "";                    // drawn inside the pedal (stockScreen)
  if (p.mode !== MODE_OPEN) return "";
  if (!fw) return `<div class="scr-head" style="color:#9aa"><span>OPENGP5</span></div>`;
  if (fw === "nam") {
    const n = state.nam, i = n ? n.bank.findIndex((s) => s && s.crc === n.playing) : -1;
    const name = i >= 0 ? n.bank[i].name : n ? "built-in" : "";
    return `<div class="scr-head" style="color:#ffc72c"><span>AMP</span><span style="color:#8a877f">${i >= 0 ? String(i + 1).padStart(2, "0") + " / 12" : ""}</span></div>
      <div class="scr-name"><span>${esc(name)}</span></div><div class="scr-foot" style="color:#ffc72c"><i></i></div>`;
  }
  if (fw === "dreamcatcher") {
    const d = state.dream;
    return `<div class="scr-head" style="color:#c9b3ff"><span>DREAMCATCHER</span></div>
      <div class="scr-name" style="color:#eee6ff"><span>${d ? "P" + (d.last + 1) : "presets"}</span></div><div class="scr-foot" style="color:#a68ef0"><i style="width:40%"></i></div>`;
  }
  if (fw === "tuner") return `<div class="scr-head" style="color:#9fe6c8"><span>TUNER</span><span>440</span></div><div class="scr-name">E</div>`;
  return `<div class="scr-head" style="color:#9fe6c8"><span>OPENGP5</span></div><div class="scr-name" style="font-size:11cqw">${esc(p.firmware.title)}</div>`;
}

function stockShown(state) {
  if (state.pedal?.mode !== MODE_STOCK) return null;
  const st = state.stock, cur = st?.list?.[st.current];
  return cur ? { n: st.current, name: cur.name } : { n: 0, name: "" };
}

// Turn the drawn volume knob without redrawing the panel (the pedal is asked a few times a second).
// (SVG's own rotate turns around the knob's centre; CSS transforms on SVG parts don't, so the turn is animated here.)
export function setKnob(root, v) {
  const g = root?.querySelector(".pedal .vol-ind");
  if (!g) return;
  const from = parseFloat(g.dataset.a) || 0, to = knobAngle(v), t0 = performance.now();
  g.dataset.a = to.toFixed(1);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 160), a = from + (to - from) * (1 - (1 - k) * (1 - k));
    g.setAttribute("transform", `rotate(${a.toFixed(1)})`);
    if (k < 1 && g.dataset.a === to.toFixed(1)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const WORLD = { nam: "w-nam", dreamcatcher: "w-dream", tuner: "w-mods", opengp5: "w-mods" };

export function pedalPanel(ctx) {
  const { state, esc } = ctx, p = state.pedal;
  const fw = p?.firmware?.kind;
  const led = !p ? LED.off : p.mode === MODE_STOCK ? LED.stock : p.mode === MODE_OPEN ? (LED[fw] || LED.opengp5) : LED.off;
  const world = !p ? "" : p.mode === MODE_STOCK ? "w-stock" : p.mode === MODE_OPEN ? (WORLD[fw] || "w-mods") : "w-flash";
  const facts = [];
  if (p) {
    facts.push(["Running", p.mode === MODE_OPEN ? (p.firmware?.title ?? "OpenGP5 firmware") : p.mode === MODE_STOCK ? "Valeton firmware" :
                p.mode === MODE_LOADER ? "Update mode" : "Not answering"]);
    if (p.firmware?.platform) facts.push(["Platform", `OpenGP5 ${p.firmware.platform}`]);
    if (fw === "nam" && state.nam) facts.push(["Tone slots", `${state.nam.bank.filter(Boolean).length} / 12`]);
    if (fw === "dreamcatcher" && state.dream) facts.push(["Presets", `${state.dream.slots.filter(Boolean).length} / 8`]);
    facts.push(["USB", p.name.split(":")[0]]);
  }
  return `<div class="${world}" style="display:contents">
    <div class="panel-head"><h3>${p ? "Your pedal" : "No pedal"}</h3>${state.sim ? '<span class="pill">simulated</span>' : ""}</div>
    <div class="panel-body">
      <div class="pedal ${p ? "" : "off"}">${pedalSvg(led, { knob: state.knob ?? null, stock: stockShown(state) })}${p?.mode === MODE_STOCK ? "" : `<div class="screen">${screen(ctx)}</div>`}</div>
      ${p ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${/^[\d /]+$/.test(v) ? "mono" : ""}">${esc(v)}</dd>`).join("")}</dl>
        ${state.view === "home" ? "" : `<div class="panel-actions"><button class="btn small" data-go="backups">Back up</button><button class="btn small" data-go="flash">Flash</button></div>`}`
      : `<p class="muted" style="text-align:center;margin-top:14px;font-size:13.5px">Connect the GP-5 with a USB cable. Launchpad finds it by itself.</p>`}
    </div></div>`;
}

// names wider than the screen slide to their end and back, like the pedal's own screen
export function fitScreen(root) {
  for (const n of root.querySelectorAll(".scr-name")) {
    const s = n.firstElementChild; if (!s) continue;
    const d = s.scrollWidth - n.clientWidth;
    n.classList.toggle("slides", d > 0);
    if (d > 0) { n.style.setProperty("--slide", `-${d}px`); n.style.setProperty("--slide-time", `${Math.max(3, d / 18 + 2)}s`); }
  }
}
