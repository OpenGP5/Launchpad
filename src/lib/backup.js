// Launchpad backups (.gp5backup): one JSON file with everything Launchpad can read from the pedal, each part
// with its SHA-256, so a restore can check it before writing anything back.
//
//   { "format": "opengp5-backup", "version": 1, "created": ISO time, "app": "OpenGP5 Launchpad x.y.z",
//     "pedal": { "mode": "open firmware", "firmware": "nam", "title": "...", "platform": "0.2.1" },
//     "parts": [ part, ... ] }
//
// Parts (open firmware): "records" (any OpenGP5 1.0 firmware: every store record it owns: its parameters, presets,
// settings), "store" (the platform's settings store, raw, 8 KB), "data-area" (raw, 56 KB),
// "nam-bank" (each slot's capture file), "dreamcatcher-presets" (decoded, readable). Raw parts restore
// everything as it was; the decoded ones restore just that firmware's things. Unknown parts are kept as they
// are and skipped on restore, so newer backups still open in older versions.
import { readStore } from "./device.js";
import { latest, IDS, decodeDreamcatcher, dcValues, dcName, fourcc } from "./gp5store.js";
import { flashRead, readBank, SLOTS, SLOT_BYTES, blobInfo } from "./gp5nam.js";
import { listFiles, readFile, TOTAL_SECTORS, SECTOR } from "./gp5files.js";
import { idName } from "./gp5store.js";
import { readPresetRaw, decodePreset, firmwareConstant, V106, PRESETS, MSG } from "./stockpresets.js";

export const FORMAT = "opengp5-backup", VERSION = 2;   // 2: only the backed-up firmware's own data
const DATA = 0x162000, DATA_SIZE = 0xE000;

const b64 = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const t = atob(s), out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out;
};
export async function sha256(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h, (v) => v.toString(16).padStart(2, "0")).join("");
}

// The settings-record / file owner id of each firmware (four letters)
export const KIND_OWNER = { nam: "AMPB", dreamcatcher: "DRMC", tuner: "TUNR" };
const KIND_TITLE = { stock: "Valeton's firmware", nam: "NAM Loader", dreamcatcher: "Dreamcatcher", tuner: "Strobe tuner", opengp5: "OpenGP5 firmware" };
const kindTitle = (k) => KIND_TITLE[k] || (k?.startsWith("fw:") ? k.slice(3) : k);

// Back up what the installed firmware keeps, and nothing else: its files, its settings record, its tone bank
// (NAM, old fixed slots) or its presets (Dreamcatcher, readable). Leftovers of other firmwares are not included.
// progress(fraction, label)
export async function makeBackup(link, pedal, appVersion, progress = () => {}) {
  if (pedal.mode === "stock firmware") return makeStockBackup(link, appVersion, progress);
  const kind = pedal.firmware?.kind ?? null, owner = KIND_OWNER[kind] || null, parts = [];
  if (!owner && kind?.startsWith("fw:")) return makeGenericBackup(link, pedal, kind, appVersion, progress);
  if (!owner) throw new Error("Launchpad doesn't know what this firmware stores, so it can't back it up.");
  progress(0.05, "Reading settings");
  const store = await readStore(link), rec = latest(store).get(fourcc(owner));
  if (kind === "dreamcatcher") {
    const presets = rec && decodeDreamcatcher(rec.data);
    if (presets) parts.push({ kind: "dreamcatcher-presets", last: presets.last + 1,
      slots: presets.slots.map((v, i) => ({ slot: i + 1, values: v, ...(presets.names?.[i] ? { name: presets.names[i] } : {}) })) });
  } else if (rec) parts.push({ kind: "settings", owner, length: rec.data.length, sha256: await sha256(rec.data), data: b64(rec.data) });
  if (kind === "nam") {                                        // tones still in the old fixed slots (before 0.4)
    progress(0.3, "Reading tones");
    const dir = await listFiles(link), slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const at = DATA + i * SLOT_BYTES;
      if (dir.used.has(64 + Math.floor((at - DATA) / SECTOR))) continue;
      const info = blobInfo(await flashRead(link, at, 68));
      if (!info || info.length > SLOT_BYTES) continue;
      const file = await flashRead(link, at, info.length);
      slots.push({ slot: i + 1, name: info.name, crc: info.crc, sha256: await sha256(file), file: b64(file) });
    }
    if (slots.length) parts.push({ kind: "nam-bank", slots });
  }
  progress(0.6, "Reading files");
  const dir = await listFiles(link), files = [];
  for (const f of dir.files) {
    if (idName(f.owner) !== owner) continue;                    // another firmware's leftovers: not ours to keep
    const bytes = await readFile(link, f);
    files.push({ owner, name: f.name, length: f.len, sha256: await sha256(bytes), data: b64(bytes) });
  }
  if (files.length) parts.push({ kind: "files", files });
  progress(1, "Done");
  return { format: FORMAT, version: VERSION, created: new Date().toISOString(), app: `OpenGP5 Launchpad ${appVersion}`,
           pedal: { mode: pedal.mode, firmware: kind, title: pedal.firmware?.title ?? null, platform: pedal.firmware?.platform ?? null }, parts };
}

// Valeton's firmware: its 100 presets, each the exact 12 4F reply (which is also the message that writes it back).
// Valeton's global settings and SnapTones/IRs aren't included (no safe way to read them yet).
async function makeStockBackup(link, appVersion, progress) {
  const version = await firmwareConstant(link);
  if (version !== V106) throw new Error("Launchpad backs up Valeton presets from firmware V1.0.6 only (this pedal runs another version).");
  const presets = [];
  for (let n = 0; n < PRESETS; n++) {
    progress(n / PRESETS, `Reading preset ${n + 1} of ${PRESETS}`);
    const raw = await readPresetRaw(link, n), p = decodePreset(raw);
    presets.push({ n: n + 1, name: p.name, sha256: await sha256(raw), data: b64(raw) });
  }
  progress(1, "Done");
  return { format: FORMAT, version: VERSION, created: new Date().toISOString(), app: `OpenGP5 Launchpad ${appVersion}`,
           pedal: { mode: "stock firmware", firmware: "stock", title: "Valeton firmware", platform: null, valeton: "1.0.6" },
           parts: [{ kind: "valeton-presets", firmware: "1.0.6", presets }] };
}

// What of a backup may go back onto a pedal running firmware `kind`: { ok, why, items: [{ id, label, part, ... }] }.
// Only a backup made from that same firmware, only its own parts (its files, its settings, its tones / presets);
// Any OpenGP5 1.0 firmware (kind "fw:<id>"): the storage is the installed firmware's alone (platform 0.5), so all
// of it: every store record but the platform's own mark ("GP5O"), and every file, each with its own owner tag.
const CLAIM = fourcc("GP5O");
async function makeGenericBackup(link, pedal, kind, appVersion, progress) {
  const parts = [], records = [];
  progress(0.05, "Reading settings and presets");
  for (const [id, r] of latest(await readStore(link))) {
    if (id === CLAIM) continue;
    records.push({ id, length: r.data.length, sha256: await sha256(r.data), data: b64(r.data) });
  }
  if (records.length) parts.push({ kind: "records", records });
  progress(0.5, "Reading files");
  const dir = await listFiles(link), files = [];
  for (const f of dir.files) {
    const bytes = await readFile(link, f);
    files.push({ owner: idName(f.owner), name: f.name, length: f.len, sha256: await sha256(bytes), data: b64(bytes) });
  }
  if (files.length) parts.push({ kind: "files", files });
  progress(1, "Done");
  return { format: FORMAT, version: VERSION, created: new Date().toISOString(), app: `OpenGP5 Launchpad ${appVersion}`,
           pedal: { mode: pedal.mode, firmware: kind, title: pedal.firmware?.title ?? null, version: pedal.firmware?.version ?? null,
                    platform: pedal.firmware?.platform ?? null }, parts };
}

// never another firmware's, never raw areas. The screen lists these; the restore re-checks at the moment of writing.
export function restorable(backup, kind) {
  const from = backup?.pedal?.firmware ?? null, owner = KIND_OWNER[kind] || null;
  if (!kind) return { ok: false, why: "Connect a pedal running OpenGP5 firmware to restore.", items: [] };
  if (!from) return { ok: false, why: "This backup doesn't say which firmware it came from, so Launchpad won't restore it.", items: [] };
  if (from !== kind) return { ok: false, why: `Made from ${kindTitle(from)}; the pedal runs ${kindTitle(kind)}. Install ${kindTitle(from)} to restore it.`, items: [] };
  if (kind === "stock") {
    const items = [];
    for (const p of backup.parts || []) if (p.kind === "valeton-presets") for (const q of p.presets || [])
      items.push({ id: `valeton:${q.n}`, kind: "valeton", label: `Preset ${String(q.n - 1).padStart(2, "0")}: ${q.name || "(no name)"}`, bad: !!q.bad, owner: "stock", preset: q });
    return { ok: true, why: items.length ? "" : "This backup holds no Valeton presets.", items };
  }
  if (!owner && kind.startsWith("fw:")) {                      // any 1.0 firmware: all its records and files
    const items = [];
    for (const p of backup.parts || []) {
      if (p.kind === "records") items.push({ id: "records", kind: "records", label: `Settings and presets (${(p.records || []).length} records)`, bad: !!p.bad, owner: kind, part: p });
      else if (p.kind === "files") for (const f of p.files || []) items.push({ id: `file:${f.owner}/${f.name}`, kind: "file", label: f.name, bad: !!f.bad, owner: kind, file: f });
    }
    return { ok: true, why: items.length ? "" : "This backup holds nothing to restore.", items };
  }
  if (!owner) return { ok: false, why: `Launchpad doesn't know what ${kindTitle(kind)} stores.`, items: [] };
  const items = [];
  for (const p of backup.parts || []) {
    if (p.kind === "files") for (const f of p.files || []) {
      if (f.owner !== owner) continue;
      items.push({ id: `file:${f.owner}/${f.name}`, kind: "file", label: f.name, bad: !!f.bad, owner, file: f });
    } else if (p.kind === "nam-bank" && kind === "nam") for (const s of p.slots || []) {
      items.push({ id: `nam:${s.slot}`, kind: "nam-slot", label: `Tone ${String(s.slot).padStart(2, "0")}: ${s.name || "(no name)"}`, bad: !!s.bad, owner, slot: s });
    } else if (p.kind === "dreamcatcher-presets" && kind === "dreamcatcher") {
      items.push({ id: "dream", kind: "dream", label: p.bad ? "Presets" : `Presets (${(p.slots || []).filter((s) => s.values).length} saved)`, bad: !!p.bad, owner, part: p });
    } else if (p.kind === "settings" && p.owner === owner) {
      items.push({ id: `settings:${owner}`, kind: "settings", label: "Settings", bad: !!p.bad, owner, part: p });
    }
  }
  return { ok: true, why: items.length ? "" : "Nothing in this backup belongs to this firmware.", items };
}
const STORE_ADDR = 0x160000;

export function serialize(backup) { return new TextEncoder().encode(JSON.stringify(backup, null, 1) + "\n"); }

// Parse and check a backup file. Returns { backup, problems: [text] }. Every part is checked for its shape, size
// and checksum before anything can be restored from it; a part that fails is marked bad (p.bad / s.bad) and
// listed in problems. (A checksum alone proves nothing about size or place: a hand-edited file carries its own.)
export async function parseBackup(bytes) {
  let b;
  try { b = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("This file is not a Launchpad backup."); }
  if (!b || b.format !== FORMAT || !Array.isArray(b.parts)) throw new Error("This file is not a Launchpad backup.");
  if (!(b.version >= 1)) throw new Error("This file is not a Launchpad backup.");
  if (b.version > VERSION) throw new Error("This backup was made by a newer Launchpad. Update Launchpad to restore it.");
  const problems = [];
  const bad = (p, why) => { p.bad = true; problems.push(why); };
  const decode = (s) => { try { return typeof s === "string" ? unb64(s) : null; } catch { return null; } };
  b.parts = b.parts.filter((p) => p && typeof p === "object");
  for (const p of b.parts) {
    if (p.kind === "store" || p.kind === "data-area") {
      const want = p.kind === "store" ? 0x2000 : DATA_SIZE;
      p.bytes = decode(p.data);
      if (!p.bytes || p.bytes.length !== want || typeof p.sha256 !== "string" || (await sha256(p.bytes)) !== p.sha256)
        bad(p, `${p.kind === "store" ? "settings store" : "data area"}: damaged`);
    } else if (p.kind === "nam-bank") {
      if (!Array.isArray(p.slots)) { p.slots = []; bad(p, "tone slots: damaged"); continue; }
      p.slots = p.slots.filter((s) => s && typeof s === "object");
      for (const s of p.slots) {
        s.bytes = decode(s.file);
        const info = s.bytes && blobInfo(s.bytes);
        if (!Number.isInteger(s.slot) || s.slot < 1 || s.slot > SLOTS || !info || info.length !== s.bytes.length ||
            s.bytes.length > SLOT_BYTES || info.crc !== s.crc || (await sha256(s.bytes)) !== s.sha256) {
          s.bad = true; problems.push(`capture in slot ${Number.isInteger(s.slot) ? s.slot : "?"}: damaged`);
        }
      }
    } else if (p.kind === "files") {
      if (!Array.isArray(p.files)) { p.files = []; bad(p, "files: damaged"); continue; }
      p.files = p.files.filter((f) => f && typeof f === "object");
      for (const f of p.files) {
        f.bytes = decode(f.data);
        if (typeof f.owner !== "string" || !/^[\x20-\x7e]{4}$/.test(f.owner) || typeof f.name !== "string" || !/^[\x20-\x7e]{1,31}$/.test(f.name) ||
            !f.bytes || f.bytes.length !== f.length || f.bytes.length > TOTAL_SECTORS * SECTOR || (await sha256(f.bytes)) !== f.sha256) {
          f.bad = true; problems.push(`file ${typeof f.name === "string" ? f.name : "?"}: damaged`);
        }
      }
    } else if (p.kind === "records") {
      if (!Array.isArray(p.records)) { p.records = []; bad(p, "settings and presets: damaged"); continue; }
      for (const r of p.records) {
        r.bytes = r && decode(r.data);
        if (!r || !Number.isInteger(r.id) || r.id < 0 || r.id > 0xFFFFFFFF || !r.bytes || r.bytes.length !== r.length || r.bytes.length > 1024 ||
            (await sha256(r.bytes)) !== r.sha256) { p.bad = true; problems.push("settings and presets: damaged"); break; }
      }
    } else if (p.kind === "settings") {
      p.bytes = decode(p.data);
      if (typeof p.owner !== "string" || !/^[\x20-\x7e]{4}$/.test(p.owner) || !p.bytes || p.bytes.length !== p.length ||
          p.bytes.length > 1024 || (await sha256(p.bytes)) !== p.sha256) bad(p, "settings: damaged");
    } else if (p.kind === "valeton-presets") {
      if (!Array.isArray(p.presets)) { p.presets = []; bad(p, "Valeton presets: damaged"); continue; }
      p.presets = p.presets.filter((q) => q && typeof q === "object");
      for (const q of p.presets) {
        q.bytes = decode(q.data);
        let ok = Number.isInteger(q.n) && q.n >= 1 && q.n <= PRESETS && q.bytes && q.bytes.length === MSG && q.bytes[0] === 0x12 && q.bytes[1] === 0x4F &&
          typeof q.sha256 === "string" && (await sha256(q.bytes)) === q.sha256;
        if (ok) try { q.preset = decodePreset(q.bytes); } catch { ok = false; }
        if (!ok) { q.bad = true; problems.push(`Valeton preset ${Number.isInteger(q.n) ? String(q.n - 1).padStart(2, "0") : "?"}: damaged`); }
      }
    } else if (p.kind === "dreamcatcher-presets") {
      const ok = Array.isArray(p.slots) && p.slots.length === 8 && Number.isInteger(p.last) && p.last >= 1 && p.last <= 8 &&
        p.slots.every((s) => s && (s.values === null || dcValues(s.values)));       // 20 values (older backups) .. 35
      if (!ok) { p.slots = []; bad(p, "Dreamcatcher presets: damaged"); }
      else p.slots.forEach((s) => { if (s.values) s.values = dcValues(s.values); s.name = typeof s.name === "string" ? dcName(s.name) : ""; });
    }
  }
  return { backup: b, problems };
}

export { unb64, b64 };
