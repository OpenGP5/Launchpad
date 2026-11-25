// Device layer, backups and flashing against the simulated pedal (src/lib/sim.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SimPedal, fastTiming } from "../src/lib/sim.js";
import * as F from "../src/lib/gp5flash.js";
import { locate, identify, storeSave, readStore, MODE_OPEN } from "../src/lib/device.js";
import { latest, IDS, encodeDreamcatcher, decodeDreamcatcher, DC } from "../src/lib/gp5store.js";
import { makeBackup, parseBackup, serialize, restorable } from "../src/lib/backup.js";
import { convertNam, putCapture, readBank } from "../src/lib/gp5nam.js";

fastTiming();
const FW = (f) => new URL(`../src/firmware/${f}`, import.meta.url);

test("recognises GP-5 USB port names and skips nearby GP-50 ports", async () => {
  const p = new SimPedal({ mode: F.MODE_LOADER });
  const gp5 = "Valeton GP-5 MIDI 1";
  p.names = async () => ["GP-50:GP-50 MIDI 1 16:0", gp5];
  assert.deepEqual(await locate(p), { name: gp5, mode: F.MODE_LOADER });
  const open = "GP-5 Open FW MIDI 1";
  p.names = async () => [gp5, open];
  assert.deepEqual(await locate(p), { name: open, mode: MODE_OPEN });
});

test("leaves GP-50 ports alone during GP-5 discovery and flashing", async () => {
  const p = new SimPedal({ mode: F.MODE_LOADER });
  p.names = async () => ["GP-50:GP-50 MIDI 1 16:0", "GP-50 Open FW MIDI 1"];
  assert.equal(await locate(p), null);
  await assert.rejects(F.flash(p, [[F.SECTIONS.dsp, Uint8Array.of(1)]], () => {}), /No GP-5 found/);
  assert.deepEqual(p.sent, []);
});

test("identifies the simulated NAM player", async () => {
  const p = new SimPedal({ firmware: "nam" });
  const d = await locate(p);
  assert.equal(d.mode, MODE_OPEN);
  const link = await p.open(d.name);
  const fw = await identify(link);
  assert.equal(fw.kind, "nam"); assert.equal(fw.platform, "0.2.1");
});

test("a firmware that doesn't name itself (default \"opengp5\") is recognised from its code", async () => {
  const p = new SimPedal({ firmware: "dreamcatcher", identity: true, platform: "0.5.2" });
  p.firmware = "opengp5";                         // Dreamcatcher 1.1.0 built on platform 0.5.2: no fw_name()
  const link = await p.open((await locate(p)).name);
  const fw = await identify(link);
  assert.equal(fw.kind, "dreamcatcher"); assert.equal(fw.platform, "0.5.2"); assert.equal(fw.name, "opengp5");
});

test("flashes real images and recognises them from their code", async () => {
  const p = new SimPedal({ firmware: "nam" });
  for (const [file, kind] of [["GP-5_dreamcatcher.bin", "dreamcatcher"], ["GP-5_nam-loader.bin", "nam"]]) {
    const { sections } = F.inspect(new Uint8Array(readFileSync(FW(file))));
    const mode = await F.flash(p, sections, () => {}, null);
    assert.equal(mode, MODE_OPEN);
    const link = await p.open((await locate(p)).name);
    assert.equal((await identify(link)).kind, kind);
  }
});

test("store writes, backup and restore check", async () => {
  const p = new SimPedal({ firmware: "dreamcatcher" });
  const link = await p.open((await locate(p)).name);
  const slots = Array(DC.SLOTS).fill(null); slots[0] = DC.DEFAULTS.slice(); slots[3] = DC.DEFAULTS.map((v) => v >> 1);
  for (let k = 0; k < 30; k++) await storeSave(link, IDS.dreamcatcher, encodeDreamcatcher({ last: k % 8, slots }));
  const got = decodeDreamcatcher(latest(await readStore(link)).get(IDS.dreamcatcher).data);
  assert.equal(got.last, 29 % 8); assert.deepEqual(got.slots[3], slots[3]);

  // a NAM capture left by another firmware: not Dreamcatcher's, so not in its backup
  await putCapture(link, 4, new Uint8Array(4448).fill(1).map((v, i) => i < 4 ? [0x41, 0x32, 0x52, 0x31][i] : v));
  const b = await makeBackup(link, { mode: MODE_OPEN, firmware: { kind: "dreamcatcher", title: "Dreamcatcher", platform: "0.5.1" } }, "test");
  const { backup, problems } = await parseBackup(serialize(b));
  assert.deepEqual(problems, []);
  assert.deepEqual(backup.parts.map((x) => x.kind), ["dreamcatcher-presets"]);
  // a damaged preset part is caught
  const text = new TextDecoder().decode(serialize(b)).replace('"last": ', '"last": 99, "x": ');
  assert.ok((await parseBackup(new TextEncoder().encode(text))).problems.length > 0);
});

test("platform 0.4: identity command and store reload", async () => {
  const p = new SimPedal({ firmware: "dreamcatcher", identity: true, platform: "0.4.0" });
  const link = await p.open((await locate(p)).name);
  const fw = await identify(link);
  assert.deepEqual([fw.kind, fw.platform], ["dreamcatcher", "0.4.0"]);
  const slots = Array(DC.SLOTS).fill(null); slots[1] = DC.DEFAULTS.slice();
  const r = await storeSave(link, IDS.dreamcatcher, encodeDreamcatcher({ last: 1, slots }));
  assert.equal(r.reloaded, true); assert.deepEqual(p.reloads, [IDS.dreamcatcher]);
  const old = new SimPedal({ firmware: "dreamcatcher" });            // 0.2.1: no answer -> restart
  const l2 = await old.open((await locate(old)).name);
  assert.equal((await storeSave(l2, IDS.dreamcatcher, encodeDreamcatcher({ last: 1, slots }))).reloaded, false);
});

test("restore only onto the firmware a backup came from, only its own parts", () => {
  const files = (owner) => ({ kind: "files", files: [{ owner, name: "tone-01", length: 4, sha256: "x", data: "AAAA" }] });
  const nam = { pedal: { firmware: "nam" }, parts: [files("AMPB"), files("DRMC"), { kind: "dreamcatcher-presets", last: 1, slots: [] },
                { kind: "nam-bank", slots: [{ slot: 1, name: "a" }] }, { kind: "store", data: "" }, { kind: "data-area", data: "" },
                { kind: "settings", owner: "AMPB", data: "" }, { kind: "settings", owner: "DRMC", data: "" }] };
  const dream = { pedal: { firmware: "dreamcatcher" }, parts: [{ kind: "dreamcatcher-presets", last: 1, slots: [] }, files("AMPB")] };
  const stock = { pedal: { firmware: "stock" }, parts: [] }, unknown = { pedal: {}, parts: [files("AMPB")] };
  const ids = (b, k) => restorable(b, k).items.map((i) => i.id).sort();
  assert.deepEqual(ids(nam, "nam"), ["file:AMPB/tone-01", "nam:1", "settings:AMPB"]);     // never DRMC, never raw areas
  assert.deepEqual(ids(dream, "dreamcatcher"), ["dream"]);                                 // never the NAM file
  for (const [b, k] of [[nam, "dreamcatcher"], [nam, "stock"], [nam, "tuner"], [dream, "nam"], [dream, "stock"],
                        [stock, "nam"], [stock, "dreamcatcher"], [unknown, "nam"], [nam, null]]) {
    const r = restorable(b, k);
    assert.equal(r.ok, false, `${b.pedal.firmware} onto ${k}`); assert.deepEqual(r.items, []);
  }
});
