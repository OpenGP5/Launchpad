// Valeton's model catalog: which models each of the preset's 10 blocks can hold, and each model's parameters
// (name, range, step, default). It lives in the stock firmware's preset section (0x65, flash 0x190000), at
// +0x10000 (= flash 0x1A0000). Launchpad never ships it: it is read from the user's own stock firmware file and
// kept on this computer. Layout (docs/stock-preset-protocol.md §8, from the firmware's reader FUN_1622c):
//   +0x13 u8 number of table entries; +0x14 u32[] offset of each block's model list (0 = none)
//   list:   u32 count, u32 offset of each model record
//   record: u32 model ID, u32 FFFFFFFF, u8 parameter count, 3 pad, u16 ?, u16 offset of the category name,
//           then 0x18 bytes per parameter: u16 FFFF, u16 name offset, f32 min, f32 max, f32 step, f32 default,
//           u8 slot (0..7 in the preset), u8 FF, u8 ?, u8 kind; then the strings (model name first).
// All offsets are from the catalog start; name offsets are from the record's strings.
import { inspect } from "./gp5flash.js";

export const CATALOG_AT = 0x10000, BLOCKS = 10, PARAMS = 8;
// What the firmware's blocks are, by the categories of the models in them.
export const BLOCK_NAMES = ["Gate", "Pre FX", "Drive", "Amp", "Cab", "EQ", "Mod", "Delay", "Reverb", "SnapTone"];
export const BLOCK_SHORT = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "N→S"];   // as on the pedal

const UNITS = { 0x19: "ms", 0x82: "ms", 0x22: "Hz", 0x53: "st", 0x83: "st", 0x58: "ct" };

export class CatalogError extends Error {}

export function parseCatalog(section) {
  const d = section.subarray(CATALOG_AT);
  if (d.length < 0x100) throw new CatalogError("This firmware has no model catalog.");
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (o) => { if (o < 0 || o + 4 > d.length) throw new CatalogError("The model catalog is damaged."); return dv.getUint32(o, true); };
  const str = (o) => { let e = o; while (e < d.length && d[e]) e++; return new TextDecoder("latin1").decode(d.subarray(o, e)); };
  const entries = d[0x13];
  if (entries < BLOCKS || entries > 32) throw new CatalogError("This doesn't look like Valeton's model catalog.");
  const blocks = [];
  for (let b = 0; b < BLOCKS; b++) {
    const lo = u32(0x14 + 4 * b), models = [];
    const n = lo ? u32(lo) : 0;
    if (n > 200) throw new CatalogError("The model catalog is damaged.");
    for (let k = 0; k < n; k++) {
      const ro = u32(lo + 4 + 4 * k), np = d[ro + 8];
      if (np > PARAMS) throw new CatalogError("The model catalog is damaged.");
      const so = ro + 0x10 + np * 0x18, params = [];
      for (let p = 0; p < np; p++) {
        const e = ro + 0x10 + p * 0x18;
        const f = (i) => Math.round(dv.getFloat32(e + 4 + 4 * i, true) * 1e4) / 1e4;
        const kind = d[e + 23], min = f(0), max = f(1);
        params.push({ slot: d[e + 20], name: str(so + dv.getUint16(e + 2, true)), min, max, step: f(2), def: f(3), kind,
                      unit: UNITS[kind] || "", toggle: min === 0 && max === 1 && f(2) === 1 });
      }
      models.push({ id: u32(ro), name: str(so), category: str(so + dv.getUint16(ro + 0x0E, true)), params });
    }
    blocks.push({ index: b, name: BLOCK_NAMES[b], short: BLOCK_SHORT[b], models });
  }
  const count = blocks.reduce((n, b) => n + b.models.length, 0);
  if (count < 20 || !blocks[3].models.length) throw new CatalogError("This doesn't look like Valeton's model catalog.");
  return { blocks, count };
}

// The DSP's own list of cabinets and SnapTone slots (section 0x66, from +0x10): 0x48-byte entries
// { u16 index, u16 ?, u32 model ID, name[16], kind[16], f32 x8 defaults }. IDs 0x0A...... are cabs (block 4,
// 0x0A1000xx = user IRs), 0x0F...... SnapTone slots (block 9). The pedal's 12 24 / 12 20 lists carry the
// user-given names; these are the factory ones.
export function parseDspModels(section) {
  const dv = new DataView(section.buffer, section.byteOffset, section.byteLength), out = [];
  const str = (o) => { const e = section.subarray(o, o + 16).indexOf(0); return new TextDecoder("latin1").decode(section.subarray(o, o + (e < 0 ? 16 : e))); };
  for (let o = 0x10; o + 0x48 <= section.length && out.length < 512; o += 0x48) {
    const id = dv.getUint32(o + 4, true), top = id >>> 24;
    if (top !== 0x0A && top !== 0x0F) break;
    out.push({ id, name: str(o + 8), kind: str(o + 0x18) });
  }
  return out;
}

// Merge the DSP's cab and SnapTone lists into blocks 4 and 9, which list only one model each in the catalog.
// Each gets that block's catalog parameters (cab: VOL; SnapTone: Gain, VOL, Bass, Middle, Treble).
function addDspModels(cat, list) {
  for (const [b, top] of [[4, 0x0A], [9, 0x0F]]) {
    const blk = cat.blocks[b], base = blk.models[0];
    if (!base) continue;
    const extra = list.filter((m) => m.id >>> 24 === top && !blk.models.some((x) => x.id === m.id));
    let snap = 0;
    for (const m of extra) blk.models.push({ id: m.id, name: b === 9 ? `SnapTone ${++snap + 1}` : m.name, category: m.kind || blk.name, params: base.params, user: m.kind === "User IR" || b === 9 });
    if (b === 9 && base.name === "Empty") Object.assign(base, { name: "SnapTone 1", user: true });
  }
  cat.count = cat.blocks.reduce((n, x) => n + x.models.length, 0);
  return cat;
}

// The catalog from a whole stock firmware file (.hfw / .bin with the 0x65 and 0x66 sections).
export function catalogFromImage(bytes) {
  let sections;
  try { sections = inspect(bytes).sections; } catch { throw new CatalogError("That file isn't a GP-5 firmware image."); }
  const s = sections.find(([t]) => t === 0x65);
  if (!s) throw new CatalogError("That firmware has no preset section, so it holds no model catalog. Pick Valeton's own firmware file.");
  const cat = parseCatalog(s[1]);
  const dsp = sections.find(([t]) => t === 0x66);
  return dsp ? addDspModels(cat, parseDspModels(dsp[1])) : cat;
}

// The model with this ID in block b. Blocks 4 (cab) and 9 (SnapTone) also hold the user's IRs and SnapTones,
// which aren't in the catalog: they get the block's first model's parameters and a generic name.
export function modelFor(cat, b, id) {
  const blk = cat?.blocks[b];
  if (!blk) return null;
  const m = blk.models.find((x) => x.id === id);
  if (m) return m;
  const base = blk.models[0];
  return { id, name: b === 9 ? `SnapTone ${hex(id)}` : b === 4 ? `Cab ${hex(id)}` : `Model ${hex(id)}`, category: blk.name,
           params: base && (b === 4 || b === 9) ? base.params : [], unknown: true };
}

export const hex = (v) => "0x" + (v >>> 0).toString(16).padStart(8, "0");

export function formatValue(p, v) {
  if (p.toggle) return v ? "on" : "off";
  const dec = p.step < 1 ? Math.min(3, Math.max(1, Math.ceil(-Math.log10(p.step) - 1e-9))) : 0;
  return v.toFixed(dec) + (p.unit ? " " + p.unit : "");
}

// Snap a value to the parameter's range and step, as the pedal does (FUN_45b38).
export function snap(p, v) {
  if (!Number.isFinite(v)) v = p.def;
  const s = p.step > 0 ? p.step : 1;
  const q = Math.round(v / s) * s;
  return Math.round(Math.min(p.max, Math.max(p.min, q)) * 1e4) / 1e4;
}

// Compact form kept on this computer (localStorage): the parsed catalog is a few tens of KB of JSON.
export const CATALOG_KEY = "valeton-catalog-v2";
export function loadSavedCatalog() {
  try { const o = JSON.parse(localStorage.getItem(CATALOG_KEY) || "null"); return o && o.blocks?.length === BLOCKS ? o : null; } catch { return null; }
}
export function saveCatalog(cat, source) {
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ ...cat, source })); } catch { /* no storage: it is used for this session only */ }
}
