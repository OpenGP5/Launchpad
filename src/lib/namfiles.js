// The NAM player's tone bank on platform 0.4 and later: files "tone-01" .. "tone-12" of owner AMPB
// (docs/platform/storage.md); from NAM Loader 1.3 "tone-01" .. "tone-30", and 12 cab IRs "cab-01" .. "cab-12" that any
// tone can choose (its choice is kept in the firmware's settings record AMPT). Before 0.4 the tones sat at fixed
// places in the data area (gp5nam.js readBank / putCapture); moveTonesToFiles() carries them over once.
import { listFiles, writeFile, deleteFile, readFile, RUNS, SECTOR } from "./gp5files.js";
import { flashRead, blobInfo, dspCaptureCrc, crc32, SLOTS, SLOT_BYTES } from "./gp5nam.js";
import { fourcc, latest } from "./gp5store.js";
import { cmd, readStore, storeSave } from "./device.js";
import { cabInfo, cabNameBytes, cabToCab2 } from "./cabir.js";

export const NAM_OWNER = fourcc("AMPB");
export const toneName = (i) => `tone-${String(i + 1).padStart(2, "0")}`;
// a cab IR: "cab-NN" (lib/cabir.js makes the file); NAM Loader 1.1 .. 1.2: tone slot NN's, 1.3: IR NN of the bank
export const cabFileName = (i) => `cab-${String(i + 1).padStart(2, "0")}`;
export const IRS = 12;

// What the NAM Loader on the pedal has: 1.3 and later 30 slots and an IR bank; before, 12 slots with an IR each.
export function namLayout(firmware) {
  const [a, b] = String(firmware?.version || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const irBank = firmware?.kind === "nam" && (a > 1 || (a === 1 && b >= 3));
  return { slots: irBank ? 30 : SLOTS, irs: IRS, irBank };
}
const DATA = RUNS[1].base;                          // the old data area = files run B
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// { bank: [{ name, crc, length, file } | null] x slots, cabs: [{ taps, format, name, file } | null] x 12, dir,
//   legacy: [slot numbers holding a tone the old way] }
export async function readToneFiles(link, { slots = SLOTS } = {}) {
  const dir = await listFiles(link), bank = Array(slots).fill(null), cabs = Array(IRS).fill(null);
  for (const f of dir.files) {
    const c = f.owner === NAM_OWNER && f.name.match(/^cab-(\d\d)$/), ci = c ? +c[1] - 1 : -1;
    if (ci >= 0 && ci < IRS) {
      const head = await flashRead(link, f.addr + 64, 16), info = cabInfo(head);
      if (info) cabs[ci] = { ...cabInfo(head, await flashRead(link, f.addr + 64 + 16 + info.tapBytes, cabNameBytes)), file: f };
      continue;
    }
    const m = f.owner === NAM_OWNER && f.name.match(/^tone-(\d\d)$/);
    const i = m ? +m[1] - 1 : -1;
    if (i < 0 || i >= slots) continue;
    const info = blobInfo(await flashRead(link, f.addr + 64, 68));
    if (info) bank[i] = { ...info, file: f };
  }
  const legacy = [];
  for (let i = 0; i < SLOTS; i++) {
    const at = DATA + i * SLOT_BYTES, sector = Math.floor((at - DATA) / SECTOR);
    if (dir.used.has(64 + sector)) continue;          // a file lives there now
    const info = blobInfo(await flashRead(link, at, 68));
    if (info) { legacy.push(i); if (!bank[i]) bank[i] = { ...info, old: true }; }   // still played (the firmware falls back)
  }
  return { bank, cabs, dir, legacy };
}

async function waitPlaying(link, crc) {
  for (let k = 0; k < 20; k++) { await sleep(400); if ((await dspCaptureCrc(link)) === crc) return true; }
  return false;
}

// Put a capture file into tone slot i and wait until the pedal plays it. Short of room, IRs still in the old
// format are made smaller first (one sector each instead of two; the same IR to the pedal's ear).
export async function putToneFile(link, i, blob, progress = () => {}) {
  if (blob.length > SLOT_BYTES) throw new Error("this capture is too big for a slot (only A2-Lite fits)");
  const t = await readToneFiles(link), opts = { avoidRuns: t.legacy.length ? [1] : [] };
  try { await writeFile(link, NAM_OWNER, toneName(i), blob, progress, opts); }
  catch (e) {
    if (!/Not enough room/.test(e.message) || !t.cabs.some((c) => c?.format === 1)) throw e;
    await shrinkCabs(link);
    await writeFile(link, NAM_OWNER, toneName(i), blob, progress, opts);
  }
  await cmd(link, [0x7E, 0x0E, ...[NAM_OWNER & 255, (NAM_OWNER >>> 8) & 255, (NAM_OWNER >>> 16) & 255, NAM_OWNER >>> 24]], 500);
  return waitPlaying(link, blobInfo(blob).crc);
}

export async function emptyToneFile(link, i) { return deleteFile(link, NAM_OWNER, toneName(i)); }

// Move the tones stored the old way into files (only slots that have no file yet), check each, then erase the old
// copies. Returns how many moved. progress(fraction)
export async function moveTonesToFiles(link, progress = () => {}) {
  const t = await readToneFiles(link);
  const todo = t.legacy.filter((i) => !t.bank[i] || t.bank[i].old);
  let moved = 0;
  for (const i of todo) {
    const at = DATA + i * SLOT_BYTES, info = blobInfo(await flashRead(link, at, 68));
    const blob = await flashRead(link, at, info.length);
    if (crc32(blob.subarray(12)) !== info.crc) continue;          // damaged: leave it where it is
    await writeFile(link, NAM_OWNER, toneName(i), blob, () => {}, { avoidRuns: [1] });
    moved++; progress(moved / (todo.length + 1));
  }
  // erase the old area's sectors that no file uses (the old tones are now files; damaged ones go too)
  const dir = await listFiles(link);
  for (let s = 0; s < RUNS[1].sectors; s++) {
    if (dir.used.has(64 + s)) continue;
    const sec = await flashRead(link, RUNS[1].base + s * SECTOR, SECTOR);
    if (sec.every((v) => v === 0xFF)) continue;
    const r = await cmd(link, [0x7E, 0x07, ...[0, 0, 0, 0].map((_, k) => ((RUNS[1].base + s * SECTOR) >>> (8 * k)) & 255)], 5000);
    if (!r || !r[2]) throw new Error("The pedal refused to clear the old tone area.");
  }
  progress(1);
  return moved;
}

// A cab IR: write it (the pedal picks it up within about a second when a tone playing has it), or remove it.
export async function putCabFile(link, i, bytes, progress = () => {}) {
  await writeFile(link, NAM_OWNER, cabFileName(i), bytes, progress);
}
export async function removeCabFile(link, i) { return deleteFile(link, NAM_OWNER, cabFileName(i)); }

// Rewrite every IR still in the old float format ("CAB1", two sectors) in the 16-bit one ("CAB2", one sector; NAM
// Loader 1.3 reads both). Returns how many. The pedal plays IRs in 16 bits anyway.
export async function shrinkCabs(link, progress = () => {}) {
  const dir = await listFiles(link), todo = [];
  for (const f of dir.files) {
    const c = f.owner === NAM_OWNER && f.name.match(/^cab-(\d\d)$/);
    if (c && cabInfo(await flashRead(link, f.addr + 64, 16))?.format === 1) todo.push(f);
  }
  for (let k = 0; k < todo.length; k++) {
    await writeFile(link, NAM_OWNER, todo[k].name, cabToCab2(await readFile(link, todo[k])));
    progress((k + 1) / todo.length);
  }
  return todo.length;
}

// ---- each tone's IR (NAM Loader 1.3): the settings record AMPT, as nds32/firmware.c keeps it
// 31 entries (slots 1..30, then the built-in capture) of 12 bytes: crc u32, gate, bass, mid, treble, ir, 3 spare;
// ir 0 = the default (the IR of the same number, if there is one), 1 = none, 2.. = IR 1.. . A record of 13 x 8 bytes
// was saved by 1.2 (12 slots + built-in, no IR). An entry belongs to the capture with that checksum.
export const TONE_REC = fourcc("AMPT");
const ENTRIES = 31, ENTRY = 12;
export function parseToneRecord(data) {
  const out = Array.from({ length: ENTRIES }, () => ({ crc: 0, v: [0, 12, 12, 12], ir: 0 }));
  if (!data) return out;
  const old = data.length === 13 * 8, size = old ? 8 : ENTRY;
  if (!old && data.length !== ENTRIES * ENTRY) return out;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < (old ? 13 : ENTRIES); i++) {
    const e = out[old && i === 12 ? 30 : i], o = i * size;
    e.crc = dv.getUint32(o, true); e.v = [...data.subarray(o + 4, o + 8)]; e.ir = old ? 0 : data[o + 8];
  }
  return out;
}
export function makeToneRecord(entries) {
  const d = new Uint8Array(ENTRIES * ENTRY), dv = new DataView(d.buffer);
  entries.forEach((e, i) => { dv.setUint32(i * ENTRY, e.crc >>> 0, true); d.set(e.v, i * ENTRY + 4); d[i * ENTRY + 8] = e.ir; });
  return d;
}
/** The IR each slot plays (-1: none), as the firmware decides: its choice, else the IR of the same number. */
export function toneIrs(entries, bank, cabs) {
  return bank.map((s, i) => {
    if (!s) return -1;
    const e = entries[i];
    if (e.crc === s.crc && e.crc && e.ir) return e.ir >= 2 && cabs[e.ir - 2] ? e.ir - 2 : -1;
    return i < IRS && cabs[i] ? i : -1;
  });
}
export async function readToneRecord(link) { return parseToneRecord(latest(await readStore(link)).get(TONE_REC)?.data); }
/** Slot i (its capture: crc) plays IR ir (-1: none) from now on; the pedal takes it at once. */
export async function setToneIr(link, i, crc, ir) {
  const entries = await readToneRecord(link), e = entries[i];
  if (e.crc !== crc || !crc) { e.crc = crc; e.v = [0, 12, 12, 12]; }      // a capture without settings yet: as the firmware starts one
  e.ir = ir < 0 ? 1 : ir + 2;
  await storeSave(link, TONE_REC, makeToneRecord(entries));
}
