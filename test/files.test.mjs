// Files (platform 0.4): written by Launchpad's JavaScript on a simulated pedal, read back by the platform's own C
// (test/c/files_ref.c compiled here): same files, same lengths, intact; replacing, deleting, running out of room.
import { test } from "node:test";
import { PLATFORM_NDS32 } from "./platform-dir.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SimPedal } from "../src/lib/sim.js";
import { locate } from "../src/lib/device.js";
import { writeFile, deleteFile, listFiles, readFile, TOTAL_SECTORS } from "../src/lib/gp5files.js";
import { fourcc } from "../src/lib/gp5store.js";

const bin = join(mkdtempSync(join(tmpdir(), "lp-")), "files_ref");
execFileSync("cc", ["-std=c99", "-O1", "-w", "-I" + PLATFORM_NDS32,
  fileURLToPath(new URL("./c/files_ref.c", import.meta.url)), "-o", bin]);
const cList = (flash, owners) => execFileSync(bin, owners.map(String), { input: flash.subarray(0x13F000, 0x18A000) }).toString().trim().split("\n").filter(Boolean).sort();
const bytes = (n, seed) => { const d = new Uint8Array(n); for (let i = 0; i < n; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; d[i] = seed >>> 24; } return d; };

test("files written in JS read back in the platform's C", async () => {
  const p = new SimPedal({ firmware: "nam" });
  const link = await p.open((await locate(p)).name);
  const A = fourcc("AMPB"), D = fourcc("DRMC");
  for (let i = 1; i <= 12; i++) await writeFile(link, A, `tone-${String(i).padStart(2, "0")}`, bytes(4448, i));
  await writeFile(link, D, "loop", bytes(20000, 99));
  await writeFile(link, A, "tone-03", bytes(4448, 333));                     // replace
  await deleteFile(link, A, "tone-07");
  const js = (await listFiles(link)).files.map((f) => `${f.owner} ${f.name} ${f.len} 1`).sort();
  assert.deepEqual(cList(p.flash, [A, D]), js);
  assert.equal(js.length, 12);
  const t3 = (await listFiles(link)).files.find((f) => f.name === "tone-03");
  assert.deepEqual(await readFile(link, t3), bytes(4448, 333));
  // full: a file too big for the space left is refused, nothing changes
  const before = cList(p.flash, [A, D]);
  await assert.rejects(writeFile(link, D, "huge", bytes(TOTAL_SECTORS * 4096, 5)), /Not enough room/);
  assert.deepEqual(cList(p.flash, [A, D]), before);
});

test("a half-written file is never seen (header last)", async () => {
  const p = new SimPedal({ firmware: "nam" });
  const link = await p.open((await locate(p)).name);
  const A = fourcc("AMPB");
  await writeFile(link, A, "tone-01", bytes(4448, 1));
  // cut the power after the data but before the header: simulate by refusing the header write
  const send = link.send.bind(link);
  let writes = 0;
  link.send = async (raw) => { const m = (await import("../src/lib/gp5flash.js")).parseSysex(raw); if (m.payload[1] === 0x08 && ++writes > 80) throw new Error("power cut"); return send(raw); };
  await assert.rejects(writeFile(link, A, "tone-02", bytes(4448, 2)));
  link.send = send;
  assert.deepEqual(cList(p.flash, [A]), [`${A} tone-01 4448 1`]);
});

test("NAM tones: old slots move into files, then live there", async () => {
  const { readToneFiles, putToneFile, moveTonesToFiles, emptyToneFile } = await import("../src/lib/namfiles.js");
  const { putCapture, blobInfo } = await import("../src/lib/gp5nam.js");
  const p = new SimPedal({ firmware: "nam" });
  const link = await p.open((await locate(p)).name);
  const blob = (seed, name) => {                     // a well-formed capture file of 4448 bytes
    const b = bytes(4448, seed); b.set([0x41, 0x32, 0x52, 0x31]); new DataView(b.buffer).setUint32(4, 4448, true);
    b.fill(0, 44, 68); b.set(new TextEncoder().encode(name), 44);
    new DataView(b.buffer).setUint32(8, (crc32(b.subarray(12))) >>> 0, true); return b;
  };
  const { crc32 } = await import("../src/lib/gp5nam.js");
  const tones = [blob(1, "One"), blob(2, "Two"), blob(3, "Three")];
  for (const [i, b] of [[0, tones[0]], [1, tones[1]], [4, tones[2]]]) await putCapture(link, i, b);   // the old way
  let t = await readToneFiles(link);
  assert.deepEqual(t.legacy, [0, 1, 4]);
  assert.equal(await moveTonesToFiles(link), 3);
  t = await readToneFiles(link);
  assert.deepEqual(t.legacy, []);
  assert.deepEqual(t.bank.map((s) => s && s.name), ["One", "Two", null, null, "Three", null, null, null, null, null, null, null]);
  assert.ok(p.flash.subarray(0x162000, 0x170000).every((v) => v === 0xFF), "old area cleared");
  assert.equal(await putToneFile(link, 2, blob(9, "Nine")), true);           // and now the new way
  await emptyToneFile(link, 0);
  t = await readToneFiles(link);
  assert.deepEqual(t.bank.map((s) => s && s.name).slice(0, 5), [null, "Two", "Nine", null, "Three"]);
  assert.deepEqual(cList(p.flash, [fourcc("AMPB")]), ["1112558913 tone-02 4448 1", "1112558913 tone-03 4448 1", "1112558913 tone-05 4448 1"]);
});

test("start-up claim (platform C): same firmware keeps, no mark keeps, another firmware wipes", () => {
  const b = join(mkdtempSync(join(tmpdir(), "lp-")), "claim");
  execFileSync("cc", ["-std=c99", "-O1", "-w", "-I" + PLATFORM_NDS32,
    fileURLToPath(new URL("./c/claim_ref.c", import.meta.url)), "-o", b]);
  assert.equal(execFileSync(b).toString().trim(), "OK");
});
