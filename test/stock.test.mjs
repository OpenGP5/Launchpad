// Valeton stock presets: the model catalog, the preset message codec, and the protocol against the simulated
// stock pedal (src/lib/stocksim.js). Checks that need Valeton's firmware use the local copy if there is one
// (firmware/GP-5_USB_V1.0.6_20250626.bin, never committed) and are skipped otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogFromImage, modelFor, snap, formatValue } from "../src/lib/stockcat.js";
import * as S from "../src/lib/stockpresets.js";
import { SimPedal } from "../src/lib/sim.js";
import { inspect, MODE_STOCK } from "../src/lib/gp5flash.js";

const IMG = fileURLToPath(new URL("../../../firmware/GP-5_USB_V1.0.6_20250626.bin", import.meta.url));
const have = existsSync(IMG);
const image = have ? new Uint8Array(readFileSync(IMG)) : null;
const cat = have ? catalogFromImage(image) : null;
const factory = have ? (() => {
  const s = inspect(image).sections.find(([t]) => t === 0x65)[1];
  return Array.from({ length: 50 }, (_, k) => S.decodeRecord(s.subarray(k * 0x400, k * 0x400 + 0x1DB)));
})() : null;

async function pedal(opts = {}) {
  const sim = new SimPedal({ mode: MODE_STOCK, stock: factory ? { factory } : {} , ...opts });
  const [name] = await sim.names();
  return { sim, link: await sim.open(name) };
}

test("catalog: 10 blocks, their models and named parameters", { skip: !have && "no local stock firmware" }, () => {
  assert.deepEqual(cat.blocks.map((b) => b.models.length), [1, 10, 10, 32, 40, 5, 11, 10, 10, 80]);
  assert.equal(modelFor(cat, 4, 0x0A000022).name, "UK GRN 4x12");
  assert.equal(modelFor(cat, 4, 0x0A100000).name, "User IR 1");
  assert.equal(modelFor(cat, 9, 0x0F000001).name, "SnapTone 2");
  const d = modelFor(cat, 7, 0x0B000006);
  assert.equal(d.name, "Sweep Echo");
  assert.deepEqual(d.params.map((p) => `${p.slot}:${p.name}`), ["0:Mix", "1:Time", "2:F.Back", "3:S-Depth", "4:S-Rate", "7:Trail"]);
  assert.equal(formatValue(d.params[1], 542), "542 ms");
  assert.equal(snap(d.params[1], 5000), d.params[1].max);
});

test("catalog: every factory preset's values fit its models' ranges (slots, not positions)", { skip: !have && "no local stock firmware" }, () => {
  // Valeton's own data has two Trail values of 50 on 0..1 switches (N-Star twice, Sweet Echo three times)
  const quirks = new Set(["N-Star/Trail", "Sweet Echo/Trail"]);
  let checked = 0;
  for (const p of factory) {
    assert.ok(p, "factory record readable");
    for (let b = 0; b < 10; b++) {
      const m = modelFor(cat, b, p.models[b]);
      assert.ok(!m.unknown, `${p.name}: block ${b} model ${p.models[b].toString(16)} is in the catalog`);
      for (const q of m.params) {
        const v = p.params[b][q.slot];
        if (quirks.has(`${m.name}/${q.name}`) && v === 50) continue;
        assert.ok(v >= q.min && v <= q.max, `${p.name} ${m.name} ${q.name} = ${v} (${q.min}..${q.max})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});

test("codec: encode then decode gives the same preset", () => {
  const p = { name: "Test 1", volume: 66, tempo: 120, mask: 0b1011, order: [0, 1, 2, 9, 3, 4, 5, 6, 7, 8],
    models: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], params: Array.from({ length: 10 }, (_, b) => Array.from({ length: 8 }, (_, k) => b * 10 + k + 0.5)),
    groupA: 7, groupB: 5 };
  const m = S.encodePreset(p, 42);
  assert.equal(m.length, 0x1E8);
  assert.deepEqual([m[0], m[1], m[2], m[3]], [0x11, 0x4F, 42, 0]);
  const r = m.slice(); r[0] = 0x12;
  assert.ok(S.samePreset(S.decodePreset(r), p));
});

test("codec: factory records survive the message round trip", { skip: !have && "no local stock firmware" }, () => {
  for (const p of factory) { const r = S.encodePreset(p, 0); r[0] = 0x12; assert.ok(S.samePreset(S.decodePreset(r), p), p.name); }
});

test("protocol: list, read, write with read-back, rename, reset", async () => {
  const { sim, link } = await pedal();
  const list = await S.listPresets(link);
  assert.equal(list.length, 100);
  assert.equal(list[50].name, "GP-5");
  const p = await S.readPreset(link, 3);
  assert.equal(p.name, list[3].name);
  p.name = "Launchpad"; p.volume = 77; p.params[3][0] = 12;
  const back = await S.writePreset(link, 60, p);
  assert.equal(back.name, "Launchpad");
  assert.equal(sim.stock.flashWrites, 1);
  assert.equal((await S.listPresets(link))[60].name, "Launchpad");
  await S.renamePreset(link, 60, "New name!");
  assert.equal((await S.readPreset(link, 60)).name, "New name!");
  const reset = await S.resetPreset(link, 60);
  assert.equal(reset.name, "GP-5");
  const f = await S.resetPreset(link, 3);
  assert.equal(f.name, list[3].name);
});

test("protocol: a refused or damaged write is reported", async () => {
  const { sim, link } = await pedal();
  const p = await S.readPreset(link, 0);
  sim.stock.failNextWrite = true;
  await assert.rejects(S.writePreset(link, 5, p), /refused/);
  sim.stock.corruptNextWrite = true;
  await assert.rejects(S.writePreset(link, 5, p), /didn't read back/);
  await assert.rejects(S.writePreset(link, 5, { ...p, order: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8] }), /order/);
});

test("protocol: live edits reach the edit buffer and mark it changed", async () => {
  const { link } = await pedal();
  assert.equal(await S.live.select(link, 7), true);
  assert.equal(await S.currentPreset(link), 7);
  assert.equal(await S.hasUnsavedEdits(link), false);
  await S.live.param(link, 3, 1, 42.5);
  await S.live.on(link, 6, true);
  await S.live.volume(link, 31);
  const e = await S.readEditBuffer(link);
  assert.equal(e.params[3][1], 42.5);
  assert.ok(e.mask & (1 << 6));
  assert.equal(e.volume, 31);
  assert.equal(await S.hasUnsavedEdits(link), true);
  assert.equal(await S.firmwareConstant(link), S.V106);
});

test("protocol: dangerous commands are never sent", async () => {
  const { link } = await pedal();
  for (const c of [0x40, 0x6F, 0x5A, 0x53, 0x21, 0x25]) await assert.rejects(S.command(link, [0x11, c, 0, 0]), /doesn't send/);
});

test("preset files: write and read back", () => {
  const p = { name: "File", volume: 50, tempo: 120, mask: 1, order: [0, 1, 2, 9, 3, 4, 5, 6, 7, 8], models: Array(10).fill(0),
    params: Array.from({ length: 10 }, () => Array(8).fill(1)), groupA: 7, groupB: 7 };
  assert.ok(S.samePreset(S.readPresetFile(S.presetFile(p)), p));
  assert.throws(() => S.readPresetFile(new TextEncoder().encode("{}")), /isn't a GP-5 preset/);
});

test("backups: Valeton presets back up, check, and only go back onto Valeton's firmware", async () => {
  const { makeBackup, parseBackup, serialize, restorable } = await import("../src/lib/backup.js");
  const { sim, link } = await pedal();
  const b = await makeBackup(link, { mode: MODE_STOCK, firmware: null }, "test");
  assert.equal(b.pedal.firmware, "stock");
  const bytes = serialize(b);
  const { backup, problems } = await parseBackup(bytes);
  assert.deepEqual(problems, []);
  const v = restorable(backup, "stock");
  assert.equal(v.ok, true);
  assert.equal(v.items.length, 100);
  for (const k of ["nam", "dreamcatcher", "tuner"]) assert.equal(restorable(backup, k).ok, false);
  // a damaged preset is caught
  const o = JSON.parse(new TextDecoder().decode(bytes));
  o.parts[0].presets[4].data = o.parts[0].presets[5].data;
  const r2 = await parseBackup(new TextEncoder().encode(JSON.stringify(o)));
  assert.equal(r2.problems.length, 1);
  assert.ok(restorable(r2.backup, "stock").items[4].bad);
  // restoring = writing each preset's backed-up content back
  const before = await S.readPreset(link, 9);
  await S.writePreset(link, 9, { ...before, name: "changed" });
  const it = v.items[9];
  await S.writePreset(link, it.preset.n - 1, it.preset.preset);
  assert.ok(S.samePreset(await S.readPreset(link, 9), before));
  void sim;
});

test("clean-up: all presets blank (1-50 too), SnapTones and IRs deleted by their IDs only", async () => {
  const { sim, link } = await pedal();
  await S.clearAllPresets(link);
  const list = await S.listPresets(link);
  assert.ok(list.every((p) => p.name === "GP-5"));
  assert.ok(S.samePreset(await S.readPreset(link, 3), await S.readPreset(link, 70)));
  const st = await S.listBank(link, "snaptone");
  assert.equal(st.filter((s) => s.used).length, 10);
  assert.equal(st[3].id, 0x0F000003);
  const r = await S.clearBank(link, "snaptone");
  assert.deepEqual(r, { deleted: 10, left: 0 });
  assert.equal((await S.clearBank(link, "ir")).left, 0);
  assert.ok(sim.stock.log.filter((c) => c === "11 27").length === 10);
  await assert.rejects(S.command(link, [0x11, 0x27, 0, 0, 0, 0]), /doesn't send/);   // never outside clearBank
});

test("missed exchanges are retried: clearing all presets survives a pedal that drops every 17th message", async () => {
  const { sim, link } = await pedal();
  sim.stock.dropEvery = 17;
  await S.clearAllPresets(link);
  sim.stock.dropEvery = 0;
  assert.ok((await S.listPresets(link)).every((p) => p.name === "GP-5"));
  const writes = sim.stock.flashWrites;
  await S.clearAllPresets(link);                 // already blank: only the reset of 51 writes again
  assert.equal(sim.stock.flashWrites - writes, 1);
});
