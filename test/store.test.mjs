// The JavaScript store writer against the platform's own C (test/c/store_ref.c, compiled here with cc):
// the same saves must give the identical 8 KB image, through many sector changes.
import { test } from "node:test";
import { PLATFORM_NDS32 } from "./platform-dir.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSave, applyPlan, latest, parseStore, fourcc, encodeDreamcatcher, decodeDreamcatcher, DC } from "../src/lib/gp5store.js";

const bin = join(mkdtempSync(join(tmpdir(), "lp-")), "store_ref");
execFileSync("cc", ["-std=c99", "-O1", "-w", "-I" + PLATFORM_NDS32,
  fileURLToPath(new URL("./c/store_ref.c", import.meta.url)), "-o", bin]);

function data(len, seed) {
  const d = new Uint8Array(len);
  for (let i = 0; i < len; i++) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; d[i] = (seed >>> 16) & 255; }
  return d;
}

test("store writes match gp5_store.c", () => {
  const ids = [fourcc("DRMC"), fourcc("AMPB"), fourcc("TUNR"), 7];
  const saves = [];
  let r = 1;
  for (let k = 0; k < 400; k++) {
    r = (Math.imul(r, 48271) % 2147483647) >>> 0;
    saves.push([ids[r % 4], [4, 164, 1, 37, 1000, 0][r % 6], r & 0xFFFF]);
  }
  const ref = new Uint8Array(execFileSync(bin, { input: saves.map((s) => s.join(" ")).join("\n") }));
  let img = new Uint8Array(0x2000).fill(0xFF);
  for (const [id, len, seed] of saves) img = applyPlan(img, planSave(img, id, data(len, seed)));
  assert.deepEqual(img, ref);
  const last = new Map(saves.map(([id, len, seed]) => [id, data(len, seed)]));
  for (const [id, rec] of latest(img)) assert.deepEqual(rec.data, last.get(id));
  assert.ok(parseStore(img).records.length > 0);
});

test("one firmware's saves keep the others' settings (C and JS agree)", () => {
  const T = fourcc("TUNR"), A = fourcc("AMPB"), D = fourcc("DRMC");
  const saves = [[T, 4, 7], [A, 4, 9]];
  for (let k = 0; k < 120; k++) saves.push([D, 164, 1000 + k]);     // many sector switches
  const ref = new Uint8Array(execFileSync(bin, { input: saves.map((s) => s.join(" ")).join("\n") }));
  let img = new Uint8Array(0x2000).fill(0xFF);
  for (const [id, len, seed] of saves) img = applyPlan(img, planSave(img, id, data(len, seed)));
  assert.deepEqual(img, ref);
  const l = latest(img);
  assert.deepEqual(l.get(T).data, data(4, 7));
  assert.deepEqual(l.get(A).data, data(4, 9));
  assert.deepEqual(l.get(D).data, data(164, 1119));
});

test("Dreamcatcher presets round-trip and clamp", () => {
  const slots = Array(DC.SLOTS).fill(null);
  slots[2] = DC.DEFAULTS.slice(); slots[5] = DC.DEFAULTS.map((v, i) => DC.MAX[i] + 5);
  const back = decodeDreamcatcher(encodeDreamcatcher({ last: 5, slots }));
  assert.equal(back.last, 5);
  assert.deepEqual(back.slots[2], DC.DEFAULTS);
  assert.deepEqual(back.slots[5], DC.MAX);
  assert.equal(back.slots[0], null);
});
