// The NAM player's tone bank on platform 0.4 and later: files "tone-01" .. "tone-12" of owner AMPB
// (docs/platform/storage.md). Before 0.4 the tones sat at fixed places in the data area (gp5nam.js readBank /
// putCapture); moveTonesToFiles() carries them over once.
import { listFiles, writeFile, deleteFile, RUNS, SECTOR } from "./gp5files.js";
import { flashRead, blobInfo, dspCaptureCrc, crc32, SLOTS, SLOT_BYTES } from "./gp5nam.js";
import { fourcc } from "./gp5store.js";
import { cmd } from "./device.js";

export const NAM_OWNER = fourcc("AMPB");
export const toneName = (i) => `tone-${String(i + 1).padStart(2, "0")}`;
const DATA = RUNS[1].base;                          // the old data area = files run B
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// { bank: [{ name, crc, length, file } | null] x 12, dir, legacy: [slot numbers holding a tone the old way] }
export async function readToneFiles(link) {
  const dir = await listFiles(link), bank = Array(SLOTS).fill(null);
  for (const f of dir.files) {
    const m = f.owner === NAM_OWNER && f.name.match(/^tone-(\d\d)$/);
    const i = m ? +m[1] - 1 : -1;
    if (i < 0 || i >= SLOTS) continue;
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
  return { bank, dir, legacy };
}

async function waitPlaying(link, crc) {
  for (let k = 0; k < 20; k++) { await sleep(400); if ((await dspCaptureCrc(link)) === crc) return true; }
  return false;
}

// Put a capture file into tone slot i and wait until the pedal plays it.
export async function putToneFile(link, i, blob, progress = () => {}) {
  if (blob.length > SLOT_BYTES) throw new Error("this capture is too big for a slot (only A2-Lite fits)");
  const t = await readToneFiles(link);
  await writeFile(link, NAM_OWNER, toneName(i), blob, progress, { avoidRuns: t.legacy.length ? [1] : [] });
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
