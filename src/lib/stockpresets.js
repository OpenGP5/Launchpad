// Valeton's own presets ("patches"), over the stock firmware's USB-MIDI commands. Everything here comes from
// static analysis of V1.0.6 (docs/stock-preset-protocol.md); the section numbers below point into that doc.
//
// Safety rules taken from it (§5):
//   - one message at a time; a long message's packets go out in order, each waiting for its ACK
//   - every preset write rewrites a 4 KB sector (4 presets), so writes go one at a time and are read back
//   - never send 11 40 / 11 6F / 11 60-61-6E (loader), 11 21-27 (SnapTone/IR storage), 11 5A (move), 11 53
import { buildSysex, parseSysex } from "./gp5flash.js";

export const PRESETS = 100, FACTORY = 50, BLOCKS = 10, PARAMS = 8, MSG = 0x1E8, NAME = 10;
export class StockError extends Error {}
// The pedal didn't answer in time (as opposed to answering "no"): worth another try after a pause.
export class NoAnswer extends StockError {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn again when the pedal missed an exchange (seen on hardware: one of ~50 back-to-back preset writes went
// unanswered; the next try worked). Every write Launchpad retries this way is idempotent (same preset again).
export async function retry(link, fn, tries = 4) {
  for (let k = 1; ; k++) {
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof NoAnswer) || k >= tries) throw e;
      await sleep(600 * k); link.flush();
    }
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const CHUNK = 19;                                  // USB packets: the pedal's decode buffer is only 0x40 bytes (§1.2)

// ------------------------------------------------------------------ transport (§1)

// Wait for the next well-formed packet that `want` accepts. Other traffic (notifications, §1.5) is skipped.
async function recvPacket(link, want, timeout) {
  const end = now() + timeout;
  while (now() < end) {
    const raw = await link.recv(Math.max(0, end - now()));
    if (raw === null) break;
    const p = parseSysex(raw);
    if (p && p.ok && want(p)) return p;
  }
  return null;
}

const isAck = (p) => p.cls === 1 && p.index === 0 && p.payload.length >= 3 && p.payload[0] === 0x14 && p.payload[1] === 0x08;

// Send one message (any length), packet by packet: count = number of packets, idx = this packet's number.
// For a 11 xx message the result is the handler's ACK status (0 = ok). For 12 xx requests, see request().
async function sendMessage(link, msg, { ackTimeout = 3000 } = {}) {
  const count = Math.max(1, Math.ceil(msg.length / CHUNK));
  if (count > 255) throw new StockError("Message too long for the pedal.");
  link.flush();
  for (let i = 0; i < count; i++) {
    await link.send(buildSysex(count, i, msg.subarray(i * CHUNK, (i + 1) * CHUNK)));
    if (i < count - 1) {                           // every packet but the last is ACKed with "keep going"
      const a = await recvPacket(link, isAck, ackTimeout);
      if (!a) throw new NoAnswer("The pedal stopped answering in the middle of a message.");
      if (a.payload[2] !== 0) throw new StockError("The pedal rejected part of a message (a packet arrived damaged).");
    }
  }
}

// A 11 xx command: true when the pedal ACKs with status 0. The pedal answers after the flash write (§4.3).
export async function command(link, bytes, timeout = 4000, { deleting = false } = {}) {
  const msg = Uint8Array.from(bytes);
  const del = deleting && (msg[1] === 0x23 || msg[1] === 0x27);      // only through deleteSlots() below
  if (msg[0] !== 0x11 || (FORBIDDEN.has(msg[1]) && !del)) throw new StockError(`Launchpad doesn't send 11 ${msg[1]?.toString(16)}.`);
  await sendMessage(link, msg);
  const a = await recvPacket(link, isAck, timeout);
  if (!a) throw new NoAnswer("The pedal didn't confirm the change.");
  return a.payload[2] === 0;
}
// Commands that hand control to the loader, write DSP-side storage, or have no range checks (§5).
const FORBIDDEN = new Set([0x40, 0x6F, 0x60, 0x61, 0x6E, 0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x5A, 0x51, 0x52, 0x53, 0x31]);

// A 12 xx request: the reply's whole message (packets joined in idx order), starting 12 xx.
export async function request(link, bytes, timeout = 2000) {
  const msg = Uint8Array.from(bytes), cmd = msg[1];
  await sendMessage(link, msg);
  const parts = [];
  let count = 0;
  const end = now() + timeout;
  while (now() < end) {
    const p = await recvPacket(link, (q) => !isAck(q), end - now());
    if (!p) break;
    if (p.index === 0) {                           // a new message starts: is it our reply?
      if (p.payload[0] !== 0x12 || p.payload[1] !== cmd) { parts.length = 0; count = 0; continue; }
      parts.length = 0; count = p.cls;
    } else if (!count || p.cls !== count || p.index !== parts.length) continue;
    parts.push(p.payload);
    if (parts.length === count) {
      const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
      return out;
    }
  }
  throw new NoAnswer("The pedal didn't answer. Is it running Valeton's firmware V1.0.6?");
}

// ------------------------------------------------------------------ the preset message (§4.2)

const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, "").slice(0, NAME);
export const cleanName = ascii;

// A preset as Launchpad edits it. `params` keeps all 8 values per block, also the hidden slots (§2).
// { name, volume, tempo, mask, order[10], models[10], params[10][8], groupA, groupB }
export function decodePreset(msg) {
  if (msg.length < MSG) throw new StockError("The preset from the pedal is incomplete.");
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength), at = (o) => o;
  const u32 = (o) => dv.getUint32(at(o), true), u16 = (o) => dv.getUint16(at(o), true);
  // the block and item headers must be where they belong, or this isn't the layout we know
  const heads = [[0x16, 0x00FF], [0x2A, 0x0000], [0x3E, 0x0001], [0x52, 0x0002], [0x1DC, 0x0003]];
  for (const [o, id] of heads) if (u16(o) !== id) throw new StockError("The pedal sent a preset in a layout Launchpad doesn't know.");
  const items = [[0x42, 0x2001], [0x4A, 0x2002], [0x56, 0x3001], [0x5E, 0x3002], [0x6C, 0x3003], [0x98, 0x3004]];
  for (const [o, id] of items) if (u16(o) !== id) throw new StockError("The pedal sent a preset in a layout Launchpad doesn't know.");
  const p = {
    name: new TextDecoder("latin1").decode(msg.subarray(6, 17)).split("\0")[0],
    version: u32(0x1E),
    volume: u32(0x46) & 0xFF,
    tempo: u32(0x4E) & 0xFFFF,
    mask: u32(0x5A),
    order: Array.from(msg.subarray(at(0x62), at(0x62) + 10)),
    models: Array.from({ length: BLOCKS }, (_, m) => u32(0x70 + 4 * m)),
    params: Array.from({ length: BLOCKS }, (_, m) => Array.from({ length: PARAMS }, (_, k) => dv.getFloat32(at(0x9C + (m * PARAMS + k) * 4), true))),
    groupA: u32(0x1E0),
    groupB: u32(0x1E4),
  };
  return p;
}

// The 11 4F message that writes preset n (§4.2, the exact inverse of FUN_433fc).
export function encodePreset(p, n) {
  const m = new Uint8Array(MSG), dv = new DataView(m.buffer);
  const w16 = (o, v) => dv.setUint16(o, v, true), w32 = (o, v) => dv.setUint32(o, v >>> 0, true);
  const item = (o, id, size) => { w16(o, id); w16(o + 2, size); };
  m[0] = 0x11; m[1] = 0x4F; w16(2, n);
  m.set(new TextEncoder().encode(ascii(p.name ?? "")), 6);
  w16(0x16, 0x00FF); w16(0x18, 0x10); item(0x1A, 0x0001, 4); w32(0x1E, 1); item(0x22, 0x0002, 4); w32(0x26, 0x514D450A);
  w16(0x2A, 0x0000); w16(0x2C, 0x10); item(0x2E, 0x1001, 4); w32(0x32, BLOCKS); item(0x36, 0x1002, 4); w32(0x3A, PARAMS);
  w16(0x3E, 0x0001); w16(0x40, 0x10); item(0x42, 0x2001, 4); w32(0x46, clampInt(p.volume, 0, 100)); item(0x4A, 0x2002, 4); w32(0x4E, p.tempo & 0xFFFF);
  w16(0x52, 0x0002); w16(0x54, 0x186);
  item(0x56, 0x3001, 4); w32(0x5A, p.mask);
  item(0x5E, 0x3002, 10); m.set(p.order, 0x62);
  item(0x6C, 0x3003, 0x28); p.models.forEach((v, i) => w32(0x70 + 4 * i, v));
  item(0x98, 0x3004, 0x140); p.params.forEach((row, b) => row.forEach((v, k) => dv.setFloat32(0x9C + (b * PARAMS + k) * 4, v, true)));
  w16(0x1DC, 0x0003); w16(0x1DE, 8); w32(0x1E0, p.groupA); w32(0x1E4, p.groupB);
  return m;
}
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

// Is this a preset Launchpad may write? Plain reasons, empty when fine.
export function problems(p) {
  const out = [];
  if (!Array.isArray(p.order) || p.order.length !== BLOCKS || [...p.order].sort((a, b) => a - b).some((v, i) => v !== i)) out.push("the block order isn't a proper order of the 10 blocks");
  if (!Array.isArray(p.models) || p.models.length !== BLOCKS) out.push("it doesn't have 10 blocks");
  if (!Array.isArray(p.params) || p.params.length !== BLOCKS || p.params.some((r) => r.length !== PARAMS || r.some((v) => !Number.isFinite(v)))) out.push("its parameter values are damaged");
  if (!(p.volume >= 0 && p.volume <= 100)) out.push("its volume is out of range");
  if (p.mask >>> BLOCKS) out.push("it switches blocks on that don't exist");
  return out;
}

export const samePreset = (a, b) => {
  const fa = (r) => r.map((row) => row.map((v) => Math.fround(v)));
  return ascii(a.name ?? "") === ascii(b.name ?? "") && a.volume === b.volume && a.tempo === b.tempo && a.mask === b.mask &&
    a.groupA === b.groupA && a.groupB === b.groupB && JSON.stringify(a.order) === JSON.stringify(b.order) &&
    JSON.stringify(a.models) === JSON.stringify(b.models) && JSON.stringify(fa(a.params)) === JSON.stringify(fa(b.params));
};

// ------------------------------------------------------------------ reading (§4.1, all safe)

const u16le = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
const u32le = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

// [{ n, slot, name }] for the 100 presets. slot ≥ 100 = the factory preset (never saved over).
export async function listPresets(link) {
  const r = await retry(link, () => request(link, [0x12, 0x40], 4000));
  if (r.length < 2 + PRESETS * 20) throw new StockError("The pedal's preset list is incomplete.");
  const dv = new DataView(r.buffer, r.byteOffset, r.byteLength), out = [];
  for (let n = 0; n < PRESETS; n++) {
    const o = 2 + n * 20;
    out.push({ n, slot: dv.getUint32(o, true), name: new TextDecoder("latin1").decode(r.subarray(o + 4, o + 15)).split("\0")[0] });
  }
  return out;
}

export async function readPreset(link, n) {
  checkN(n);
  return decodePreset(await retry(link, () => request(link, [0x12, 0x4F, ...u16le(n)], 3000)));
}
export async function readPresetRaw(link, n) {
  checkN(n);
  const r = await request(link, [0x12, 0x4F, ...u16le(n)], 3000);
  decodePreset(r);                                  // throws if it isn't the layout we know
  return r.slice(0, MSG);
}

// The current preset with its unsaved changes (12 41: the same layout without the name header).
export async function readEditBuffer(link) {
  const r = await request(link, [0x12, 0x41], 3000);
  if (r.length < 2 + MSG - 0x16) throw new StockError("The pedal's current preset arrived incomplete.");
  const full = new Uint8Array(MSG);                     // rebuild a full message (no name) so decodePreset reads it
  full.set(r.subarray(2, 2 + MSG - 0x16), 0x16);
  full[0] = 0x12; full[1] = 0x41;
  const p = decodePreset(full);
  p.name = null;
  return p;
}

// Valeton's global settings (12 10): items { id u16, size u16, value }. 0x0202 = output level × 100, which
// follows the VOLUME knob (seen on the pedal). Returns a Map id -> value (4-byte items as int32, else bytes).
export async function readGlobals(link, timeout = 800) {
  const r = await request(link, [0x12, 0x10], timeout), dv = new DataView(r.buffer, r.byteOffset, r.byteLength), out = new Map();
  for (let o = 2; o + 4 <= r.length;) {
    const id = dv.getUint16(o, true), sz = dv.getUint16(o + 2, true);
    if (!sz || o + 4 + sz > r.length) break;
    out.set(id, sz === 4 ? dv.getInt32(o + 4, true) : r.slice(o + 4, o + 4 + sz));
    o += 4 + sz;
  }
  return out;
}
export const OUTPUT_LEVEL = 0x0202;

export async function currentPreset(link) {
  const r = await request(link, [0x12, 0x43]);
  return r[2] | (r[3] << 8);
}
export async function hasUnsavedEdits(link) {
  const r = await request(link, [0x12, 0x45]);
  return r[2] === 1;
}
export async function firmwareConstant(link) {
  const r = await request(link, [0x12, 0x1A]);
  return (r[2] | (r[3] << 8) | (r[4] << 16) | (r[5] << 24)) >>> 0;
}
export const V106 = 0x01010006;

const checkN = (n) => { if (!Number.isInteger(n) || n < 0 || n >= PRESETS) throw new StockError("There is no preset " + n + "."); };

// ------------------------------------------------------------------ writing (§4.3: each one a flash write)

// Write a whole preset and read it back. Throws if the pedal reports a problem or it doesn't read back the same.
export async function writePreset(link, n, p) {
  checkN(n);
  const bad = problems(p);
  if (bad.length) throw new StockError("This preset can't be written: " + bad.join("; ") + ".");
  if (!await retry(link, () => command(link, encodePreset(p, n), 6000))) throw new StockError(`The pedal refused to save preset ${label(n)}.`);
  const back = await readPreset(link, n);
  if (!samePreset(back, p)) throw new StockError(`Preset ${label(n)} didn't read back as written. Its old contents may be gone; try writing it again.`);
  return back;
}

export async function renamePreset(link, n, name) {
  checkN(n);
  const nm = new Uint8Array(11); nm.set(new TextEncoder().encode(ascii(name)));
  if (!await retry(link, () => command(link, [0x11, 0x4C, ...u32le(n), ...nm], 6000))) throw new StockError(`The pedal refused to rename preset ${label(n)}.`);
  const back = await readPreset(link, n);
  if (back.name !== ascii(name)) throw new StockError(`Preset ${label(n)} didn't take the new name.`);
  return back;
}

// Back to Valeton's factory preset (0..49) or the blank "GP-5" preset (50..99).
export async function resetPreset(link, n) {
  checkN(n);
  if (!await retry(link, () => command(link, [0x11, 0x46, ...u16le(n), 0, 0], 6000))) throw new StockError(`The pedal refused to reset preset ${label(n)}.`);
  return readPreset(link, n);
}

// ------------------------------------------------------------------ the live edit buffer (§4.4: RAM only)

export const live = {
  select: (link, n) => { checkN(n); return command(link, [0x11, 0x43, ...u16le(n)]); },
  param: (link, block, slot, value) => {
    const f = new Uint8Array(4); new DataView(f.buffer).setFloat32(0, value, true);
    return command(link, [0x11, 0x48, ...u32le(block), ...u32le(slot), ...f]);
  },
  model: (link, block, id) => command(link, [0x11, 0x47, ...u32le(block), 0, 0, 0, 0, ...u32le(id)]),
  on: (link, block, on) => command(link, [0x11, 0x49, block, 0, 0, 0, ...u32le(on ? 1 : 0)]),
  order: (link, order) => command(link, [0x11, 0x44, ...order]),
  volume: (link, v) => command(link, [0x11, 0x42, 0x01, 0x20, 0, 0, clampInt(v, 0, 100)]),
};

// ------------------------------------------------------------------ SnapTones and user IRs (§4.5)
// Both live in the DSP's own flash. 12 24: 80 SnapTone slots, 12 20: the 20 user IR slots; reply = 12 xx, one
// "in use" byte per slot, then a 16-byte name per slot. Slot i's model ID is 0x0F000000 + i (SnapTone) or
// 0x0A100000 + i (user IR), as in the DSP's table (stockcat.js parseDspModels).
// Delete: 11 27 / 11 23 <id:u32>. The pedal looks the ID up and, if it isn't found, deletes slot 0, so
// Launchpad only sends IDs of slots the list just showed in use, and reads the list back afterwards.
export const BANKS = {
  snaptone: { list: 0x24, del: 0x27, slots: 80, id: (i) => (0x0F000000 + i) >>> 0, title: "SnapTone" },
  ir: { list: 0x20, del: 0x23, slots: 20, id: (i) => (0x0A100000 + i) >>> 0, title: "user IR" },
};
export async function listBank(link, kind) {
  const b = BANKS[kind], r = await retry(link, () => request(link, [0x12, b.list], 4000));
  if (r.length < 2 + b.slots * 17) throw new StockError(`The pedal's ${b.title} list is incomplete.`);
  return Array.from({ length: b.slots }, (_, i) => ({ i, id: b.id(i), used: r[2 + i] !== 0,
    name: new TextDecoder("latin1").decode(r.subarray(2 + b.slots + 16 * i, 2 + b.slots + 16 * (i + 1))).split("\0")[0] }));
}
// Delete every slot in use; returns { deleted, left } after reading the list back. progress(done, total)
export async function clearBank(link, kind, progress = () => {}) {
  const b = BANKS[kind], before = (await listBank(link, kind)).filter((s) => s.used);
  let k = 0;
  for (const s of before) {
    const fresh = (await listBank(link, kind))[s.i];
    if (!fresh.used || fresh.id !== s.id) { k++; continue; }
    const id = s.id;
    await retry(link, () => command(link, [0x11, b.del, id & 0xFF, (id >>> 8) & 0xFF, (id >>> 16) & 0xFF, id >>> 24], 15000, { deleting: true }));
    progress(++k, before.length);
  }
  const left = (await listBank(link, kind)).filter((s) => s.used);
  return { deleted: before.length - left.length, left: left.length };
}

// Every preset blank (Valeton's own blank preset, "GP-5"), so the factory presets don't come back in 00..49.
// 50..99: reset (11 46 gives the blank there); 00..49: the blank read from 50, written with 11 4F and read back.
// Presets that are already blank are left alone (no flash write), so running it again after an interruption
// only does what's left.
export async function clearAllPresets(link, progress = () => {}) {
  await resetPreset(link, FACTORY);
  const blank = await readPreset(link, FACTORY);
  for (let n = 0; n < PRESETS; n++) {
    if (n !== FACTORY && !samePreset(await readPreset(link, n), blank)) {
      if (n > FACTORY) await resetPreset(link, n); else await writePreset(link, n, blank);
      await sleep(30);
    }
    progress(n + 1, PRESETS);
  }
  return blank;
}
// Is this Valeton's blank preset? (for counting what's in use)
export const isBlank = (name) => name === "GP-5";

// How the pedal shows a preset number: 00..99 (Valeton's screen shows factory preset 0, "GreatPedal", as 00).
export const label = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ preset files

export const FILE_FORMAT = "valeton-gp5-preset";
export function presetFile(p) {
  return new TextEncoder().encode(JSON.stringify({ format: FILE_FORMAT, version: 1, firmware: "1.0.6", preset: { ...p, version: undefined } }, null, 1) + "\n");
}
export function readPresetFile(bytes) {
  let o;
  try { o = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new StockError("This isn't a GP-5 preset file."); }
  if (!o || o.format !== FILE_FORMAT || !o.preset) throw new StockError("This isn't a GP-5 preset file.");
  const q = o.preset, p = { name: ascii(q.name ?? ""), volume: q.volume, tempo: q.tempo ?? 120, mask: q.mask >>> 0, order: q.order,
    models: (q.models || []).map((v) => v >>> 0), params: q.params, groupA: (q.groupA ?? 7) >>> 0, groupB: (q.groupB ?? 7) >>> 0 };
  const bad = problems(p);
  if (bad.length) throw new StockError("This preset file is damaged: " + bad.join("; ") + ".");
  return p;
}

// A raw 0x1DB-byte record as stored in flash (§2), e.g. Valeton's factory presets in the firmware's 0x65 section.
export function decodeRecord(r) {
  const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
  if (r.length < 0x198 || dv.getUint16(0, true) !== 0x5AA5 || dv.getUint16(2, true) !== 1) return null;
  return {
    name: new TextDecoder("latin1").decode(r.subarray(0x0A, 0x15)).split("\0")[0], version: 1,
    volume: r[0x15], tempo: dv.getUint16(0x16, true), mask: dv.getUint32(0x18, true), order: Array.from(r.subarray(0x1C, 0x26)),
    models: Array.from({ length: BLOCKS }, (_, m) => dv.getUint32(0x26 + 4 * m, true)),
    params: Array.from({ length: BLOCKS }, (_, m) => Array.from({ length: PARAMS }, (_, k) => dv.getFloat32(0x4E + (m * PARAMS + k) * 4, true))),
    groupA: dv.getUint32(0x190, true), groupB: dv.getUint32(0x194, true),
  };
}
