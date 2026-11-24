// A simulated GP-5 for trying Launchpad without one (start the page with #sim) and for the tests.
// It is the flasher's FakePedal (ports, factory loader, update protocol) plus what an OpenGP5 platform answers:
// 7E 05 flash reads, 7E 07/08 store + data area writes, 7E 03/04 DSP commands (the NAM player's 0x7F30), and a
// control-processor flash that holds the firmware's code, so identification reads real bytes.
import { FakePedal } from "./fakepedal.js";
import * as F from "./gp5flash.js";
import { StockModel } from "./stocksim.js";
import { DC, IDS, latest, planSave, applyPlan, decodeDreamcatcher, encodeDreamcatcher, STORE_SIZE } from "./gp5store.js";
import { parseHeader, RUNS, HDR } from "./gp5files.js";
import { crc32 } from "./gp5nam.js";
import { parseToneRecord, makeToneRecord, toneIrs, TONE_REC, NAM_OWNER } from "./namfiles.js";

// NAM Loader 1.3.1's parameters (7E 10 / 7E 11), as its nds32/firmware.c answers them: gate, EQ and IR of the
// capture playing (kept per capture in the store record AMPT), and the slot playing; 1.4: its output and input
// levels (ids 8, 9).
class NamLive {
  constructor(pedal) { this.p = pedal; }
  files() {                                       // the newest copy of each of NAM Loader's files
    const f = this.p.flash, out = new Map();
    for (let r = 0; r < RUNS.length; r++) for (let s = 0; s < RUNS[r].sectors; s++) {
      const a = RUNS[r].base + s * 0x1000, h = parseHeader(f.subarray(a, a + HDR), r, s);
      if (h && h.owner === NAM_OWNER && (!out.has(h.name) || h.seq > out.get(h.name).seq)) out.set(h.name, h);
    }
    return out;
  }
  bank() {
    const fs = this.files(), two = (i) => String(i + 1).padStart(2, "0");
    const bank = Array.from({ length: 30 }, (_, i) => { const h = fs.get(`tone-${two(i)}`); return h ? { crc: u32(this.p.flash, h.addr + HDR + 8) } : null; });
    const cabs = Array.from({ length: 12 }, (_, i) => (fs.get(`cab-${two(i)}`) ? {} : null));
    return { bank, cabs };
  }
  rec() { return parseToneRecord(latest(this.p.flash.slice(STORE, STORE + STORE_SIZE)).get(TONE_REC)?.data); }
  save(entries) {
    const img = this.p.flash.slice(STORE, STORE + STORE_SIZE);
    this.p.flash.set(applyPlan(img, planSave(img, TONE_REC, makeToneRecord(entries))), STORE);
  }
  slot() { return this.bank().bank.findIndex((s) => s && s.crc === this.p.dspCrc); }
  get(id) {
    const { bank, cabs } = this.bank(), i = this.slot(), e = this.rec(), k = i < 0 ? 30 : i;
    const own = e[k].crc === this.p.dspCrc && e[k].crc;
    if (id === 0) return 1;
    if (id === 1) return 0;
    if (id >= 2 && id <= 5) return own ? e[k].v[id - 2] : [0, 12, 12, 12][id - 2];
    if ((id === 8 || id === 9) && this.p.namVersion >= "1.4.0") return own ? e[k].v[id - 4] : 24;
    if (id === 6) return i < 0 ? 0 : toneIrs(e, bank, cabs)[i] + 1;
    if (id === 7) return i + 1;
    return null;
  }
  set(id, x) {
    const { bank } = this.bank(), i = this.slot(), k = i < 0 ? 30 : i;
    if (id === 7) { if (x > 30 || (x && !bank[x - 1])) return true; this.p.dspCrc = x ? bank[x - 1].crc : 0xD3F0; return true; }
    const lv = (id === 8 || id === 9) && this.p.namVersion >= "1.4.0";
    if ((id < 2 || id > 6) && !lv) return id <= 1;
    const e = this.rec();
    if (e[k].crc !== this.p.dspCrc || !e[k].crc) { e[k].crc = this.p.dspCrc; e[k].v = [0, 12, 12, 12, 24, 24]; e[k].ir = 0; }
    if (id === 6) e[k].ir = x ? x + 1 : 1; else if (lv) e[k].v[id - 4] = x; else e[k].v[id - 2] = x;
    this.save(e); return true;
  }
}

// Dreamcatcher's live settings (platform 0.5.4, 7E 10 / 7E 11), as its nds32/controls.c answers them: loads and
// saves presets in the simulated store like the firmware does.
class DreamLive {
  constructor(pedal) { this.p = pedal; this.restore(); }
  img() { return this.p.flash.slice(STORE, STORE + STORE_SIZE); }
  restore() {
    const rec = latest(this.img()).get(IDS.dreamcatcher), d = rec && decodeDreamcatcher(rec.data);
    this.slots = d ? d.slots : Array(DC.SLOTS).fill(null);
    this.names = d?.names || Array(DC.SLOTS).fill("");
    this.preset = d ? d.last : 0;
    this.v = (d && d.slots[d.last]) ? d.slots[d.last].slice() : DC.DEFAULTS.slice();
    this.v[DC.ID.catch] = 0; this.v[DC.ID.freeze] = 0; this.v[DC.ID.overdub] = 0;
  }
  live(k) { return k === DC.ID.on || k === DC.ID.catch || k === DC.ID.freeze || k === DC.ID.overdub; }
  changed() {
    const s = this.slots[this.preset];
    return !s || this.v.some((x, k) => !this.live(k) && x !== s[k]) ? 1 : 0;
  }
  get(id) {
    if (id < DC.VOL) return this.v[id];
    switch (id) {
      case DC.P.VOLUME: return this.v[DC.VOL];
      case DC.P.PRESET: return this.preset;
      case DC.P.USED: return this.slots.reduce((m, s, i) => (s ? m | (1 << i) : m), 0);
      case DC.P.CHANGED: return this.changed();
      case DC.P.SAVE: return 0;
      case DC.P.FORMAT: return 5;
      default: return null;
    }
  }
  set(id, x) {
    if (id < DC.VOL) {
      if (id === DC.ID.catch || id === DC.ID.freeze || id === DC.ID.overdub) return false;
      this.v[id] = Math.min(x, DC.MAX[id]); return true;
    }
    if (id === DC.P.VOLUME) { this.v[DC.VOL] = Math.min(x, 255); return true; }
    if (id === DC.P.PRESET) {
      if (x >= DC.SLOTS || !this.slots[x]) return false;
      this.v = this.v.map((cur, k) => (this.live(k) ? cur : this.slots[x][k]));   // on / off and the loop stay, as on the pedal
      this.preset = x; this.save(); return true;
    }
    if (id === DC.P.SAVE) {
      if (x >= DC.SLOTS) return false;
      this.slots[x] = this.v.slice(); this.preset = x; this.save(); return true;
    }
    return false;
  }
  save() {
    const img = this.img(), data = encodeDreamcatcher({ last: this.preset, slots: this.slots, names: this.names }, 5);
    this.p.flash.set(applyPlan(img, planSave(img, IDS.dreamcatcher, data)), STORE);
  }
}

const FLASH = 0x200000, APP = 0x10000, AREA = 0x13F000, STORE = 0x160000, DATA = 0x162000, END = 0x18A000, SLOT = 4608;
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const MARKS = { nam: "push to load", dreamcatcher: "DREAMCATCHER", tuner: "play a string", opengp5: "" };

export class SimPedal extends FakePedal {
  // firmware: "nam" | "dreamcatcher" | "tuner" | "opengp5"; mode: F.MODE_OPEN / F.MODE_STOCK / F.MODE_LOADER
  // identity: the platform answers 7E 0D / 7E 0E (0.2.2 and later)
  // namVersion: the NAM Loader version it says it runs (7E 16, OpenGP5 1.0 metadata); 1.3.1 and later answer its parameters
  constructor({ mode = F.MODE_OPEN, firmware = "nam", delay = 0, identity = false, platform = "0.2.1", stock = null, namVersion = null } = {}) {
    super(mode);
    this.namVersion = namVersion;
    this.firmware = firmware; this.identity = identity; this.reloads = []; this.platform = platform;
    this.flash = new Uint8Array(FLASH).fill(0xFF);
    this.delay = delay;
    this.dspCrc = 0;
    this.installApp(firmware);
    this.stock = new StockModel(stock || {});
  }
  // ---- the developer commands of platform 0.7: a log ring like gp5_log.c's, and a load report (lib/devtools.js)
  dev() { return this.identity && this.mode === F.MODE_OPEN && !(this.platform.split(".").map(Number).reduce((a, x) => a * 1000 + x, 0) < 7000); }
  logLine(text) {
    const ms = Date.now() - (this.t0 ??= Date.now());
    const line = `[${String(Math.floor(ms / 1000)).padStart(5)}.${String(ms % 1000).padStart(3, "0")}] ${text}\n`;
    this.log = ((this.log || "") + line); this.logW = (this.logW || 0) + line.length;
    if (this.log.length > 4096) this.log = this.log.slice(-4096);                      // the pedal keeps the last 4 KB
  }
  logReply(from) {
    if (!this.logStarted) {
      this.logStarted = true;
      this.logLine(`OpenGP5 ${this.platform}, firmware ${this.firmware}, control processor 288 MHz, 44100 Hz`);
      this.logLine(`dsp: firmware ${this.firmware}, variables 1996 of 19968 bytes, GP5_LARGE 51072 of 124928`);
      this.logLine("DSP ready, version 00010000");
      this.lastLine = Date.now();
    }
    if (Date.now() - this.lastLine > 2000) {                                            // a firmware's own line now and then
      this.lastLine = Date.now(); this.n = (this.n || 0) + 1;
      this.logLine(this.n % 3 ? `knob ${this.knob ?? 150}, worst block ${60 + (this.n * 7) % 9} %` : `dsp: link ok, ${this.n * 1379} blocks`);
    }
    const end = this.logW, oldest = end - this.log.length;
    let at = from >>> 0; if (at < oldest || at > end) at = at > end ? end : oldest;
    const bytes = new TextEncoder().encode(this.log.slice(at - oldest, at - oldest + 48));
    const w = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    return [0x7E, 0x18, 1, ...w(at), ...w(end), bytes.length, ...bytes];
  }
  statusReply(reset) {
    const jit = () => Math.floor(Math.random() * 6000);
    if (reset || !this.worst) this.worst = { link: 0, loop: 0, dsp: 0 };
    const block = 417920, dblock = 278464, link = 260000 + jit(), loop = 120000 + jit(), dsp = 170000 + jit();
    this.worst.link = Math.max(this.worst.link, link); this.worst.loop = Math.max(this.worst.loop, loop); this.worst.dsp = Math.max(this.worst.dsp, dsp);
    const v = [block, link, this.worst.link, this.worst.loop, 61440, 278496, 1, dblock, dsp, this.worst.dsp, 0, 1996, 19968, 51072, 124928];
    return [0x7E, 0x14, 1, ...v.flatMap((x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255])];
  }
  installApp(firmware) {
    const code = new TextEncoder().encode(`\0OPENGP5 ${this.platform}\0${MARKS[firmware] || ""}\0`);
    this.flash.fill(0xFF, APP, AREA);
    const app = new Uint8Array(0x9000).fill(0x5A); app.set(code, 0x4000);
    this.flash.set(app, APP);
  }
  async open(name) {
    const link = await super.open(name), p = this, q = [];
    const recv = link.recv.bind(link), send = link.send.bind(link), flush = link.flush.bind(link);
    link.send = async (raw) => {                       // Valeton's preset commands go to the stock model
      if (p.mode === F.MODE_STOCK) { const r = p.stock.handle(raw); if (r) { q.push(...r); return; } }
      return send(raw);
    };
    link.recv = async (t) => {
      if (p.delay) await new Promise((r) => setTimeout(r, p.delay));
      return q.length ? q.shift() : recv(t);
    };
    link.flush = () => { q.length = 0; flush(); };
    return link;
  }
  handle(raw) {
    const before = this.written[0x62];
    const out = super.handle(raw);
    if (this.written[0x62] && this.written[0x62] !== before) {            // a flash put a new app on
      this.flash.fill(0xFF, APP, AREA); this.flash.set(this.written[0x62].subarray(0, AREA - APP), APP);
    }
    if (this.mode !== F.MODE_OPEN) return out;
    const m = F.parseSysex(raw);
    if (!m.ok || m.cls !== F.CLASS_CMD || m.payload[0] !== 0x7E) return out;
    const pl = m.payload, a = u32(pl, 2);
    switch (pl[1]) {
      case 0x0D: return this.identity ? [[0x7E, 0x0D, 1, ...this.platform.split(".").map(Number), ...new TextEncoder().encode(this.firmware), 0]] : out;
      case 0x16: {                                     // the firmware's metadata (1.0), 48 bytes at a time
        if (!this.namVersion || this.firmware !== "nam") return out;
        const json = new TextEncoder().encode(JSON.stringify({ id: "nam", name: "NAM Loader", version: this.namVersion, author: "OpenGP5", built_on: this.platform }));
        const blk = new Uint8Array(16 + json.length), dv = new DataView(blk.buffer);
        blk.set(new TextEncoder().encode("GP5META1")); dv.setUint32(8, json.length, true); blk.set(json, 12); dv.setUint32(12 + json.length, crc32(json), true);
        const off = pl[2] | (pl[3] << 8);
        return [[0x7E, 0x16, 1, blk.length & 255, blk.length >> 8, ...blk.subarray(off, off + 48)]];
      }
      case 0x0F: return this.identity && this.platform >= "0.5.2" ? [[0x7E, 0x0F, 1, this.knob ?? 150, 0, 0]] : out;
      case 0x18: return this.dev() ? [this.logReply(a)] : out;          // the log (platform 0.7)
      case 0x14: return this.dev() ? [this.statusReply(pl.length > 2 && pl[2] === 1)] : out;   // load and memory (0.7)
      case 0x0E:
        if (!this.identity) return out;
        this.reloads.push(u32(pl, 2));
        if (this.dream) this.dream.restore();
        return [[0x7E, 0x0E, this.firmware === "dreamcatcher" ? 1 : 0]];
      case 0x10: case 0x11: {                          // live settings (0.5.4)
        if (!this.identity || this.platform < "0.5.4") return out;
        if (this.firmware === "nam" && this.namVersion >= "1.3.1") {
          this.nam ??= new NamLive(this);
          const id = pl[2] | (pl[3] << 8);
          if (pl[1] === 0x10) return [[0x7E, 0x10, this.nam.set(id, u32(pl, 4)) ? 1 : 0]];
          const vals = [];
          for (let i = 0; i < Math.min(40, pl[4]); i++) { const x = this.nam.get(id + i); if (x === null) break; vals.push(x & 0xFF, x >> 8); }
          return [[0x7E, 0x11, vals.length / 2, ...vals]];
        }
        if (this.firmware !== "dreamcatcher") return pl[1] === 0x10 ? [[0x7E, 0x10, 0]] : [[0x7E, 0x11, 0]];
        this.dream ??= new DreamLive(this);
        const id = pl[2] | (pl[3] << 8);
        if (pl[1] === 0x10) return [[0x7E, 0x10, this.dream.set(id, u32(pl, 4)) ? 1 : 0]];
        const vals = [];
        for (let i = 0; i < Math.min(40, pl[4]); i++) { const x = this.dream.get(id + i); if (x === null) break; vals.push(x & 0xFF, x >> 8); }
        return [[0x7E, 0x11, vals.length / 2, ...vals]];
      }
      case 0x05: { const n = pl[6]; return [[0x7E, 0x05, a + n <= FLASH ? 1 : 0, ...this.flash.subarray(a, a + n)]]; }
      case 0x07: {
        const ok = a >= AREA && a < END && a % 0x1000 === 0;
        if (ok) this.flash.fill(0xFF, a, a + 0x1000);
        return [[0x7E, 0x07, ok ? 1 : 0]];
      }
      case 0x08: {
        const d = pl.subarray(6), ok = a >= AREA && a + d.length <= END && d.length % 4 === 0;
        if (ok) {
          for (let i = 0; i < d.length; i++) this.flash[a + i] &= d[i];
          const off = a - DATA;
          if (off >= 0 && off % SLOT === 0 && u32(this.flash, a) === 0x31523241) this.dspCrc = u32(this.flash, a + 8);
          // a finished tone file (header written last): the NAM player picks it up
          if (a % 0x1000 === 0 && u32(this.flash, a) === 0x46355047 && u32(this.flash, a + 8) === 0x42504D41 && u32(this.flash, a + 64) === 0x31523241)
            this.dspCrc = u32(this.flash, a + 64 + 8);
        }
        return [[0x7E, 0x08, ok ? 1 : 0]];
      }
      case 0x03: return [[0x7E, 0x03, 1]];
      case 0x04: {
        const r = new Uint8Array(40); r.set([0x30, 0x7F, 40, 0]); new DataView(r.buffer).setUint32(28, this.dspCrc, true);
        return [[0x7E, 0x04, 1, 40, ...r]];
      }
      default: return out;
    }
  }
}

// Make the update protocol's waits short in a simulation (the real pedal needs the long ones).
export function fastTiming() {
  Object.assign(F.Timing, { reply: 200, ack: 300, begin: 500, beginSettle: 20, settle: 20, final: 300, reenum: 2000, poll: 20 });
}
