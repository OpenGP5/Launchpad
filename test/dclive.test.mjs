// Dreamcatcher 1.2 in Launchpad: the value texts (against the firmware's own), preset formats 1-3, live settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SimPedal, fastTiming } from "../src/lib/sim.js";
import { locate, identify, paramSet, paramsRead, readStore } from "../src/lib/device.js";
import { DC, IDS, latest, decodeDreamcatcher, encodeDreamcatcher, dcValues, dcName } from "../src/lib/gp5store.js";
import { ITEMS, valueText, itemName } from "../src/lib/dcformat.js";
import { parseBackup, FORMAT } from "../src/lib/backup.js";

fastTiming();

test("value texts and names are the pedal's own (fixture printed by Dreamcatcher's controls.c)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/dreamcatcher-texts.json", import.meta.url), "utf8"));
  let n = 0;
  for (const e of fx) {
    const it = ITEMS.find((i) => i.key === e.key && (i.key !== "mix" || true));
    e.texts.forEach((want, x) => {
      const v = DC.DEFAULTS.slice();
      v[DC.ID.clock] = e.clock; v[DC.ID.shape] = e.shape; v[DC.ID.loopMode] = e.loopMode;
      v[e.key === "volume" ? DC.VOL : DC.ID[e.key]] = x;
      assert.equal(valueText(e.key, x, v), want, `${e.key} = ${x} (clock ${e.clock}, shape ${e.shape}, loop mode ${e.loopMode})`);
      assert.equal(itemName(it, v), e.names[x], `name of ${e.key} = ${x}`);
      n++;
    });
  }
  assert.ok(n > 15000, `${n} texts checked`);
});

test("preset formats 1-4 read into 35 values (and names from 4); written back in the version asked for", () => {
  const v3 = DC.DEFAULTS.map((d, i) => (i * 7) % (DC.MAX[i] + 1));
  const slots = [v3, null, null, DC.DEFAULTS.slice(), null, null, null, null];
  for (const ver of [1, 2, 3, 4]) {
    const d = decodeDreamcatcher(encodeDreamcatcher({ last: 3, slots }, ver));
    assert.equal(d.version, ver); assert.equal(d.last, 3); assert.equal(d.slots[1], null);
    const n = DC.SETTINGS[ver];
    for (let k = 0; k < DC.VOL; k++) {
      const want = k < n ? v3[k] : k === DC.ID.reverbMix ? 0 : DC.DEFAULTS[k];     // older: defaults, no reverb
      assert.equal(d.slots[0][k], want, `v${ver} setting ${DC.PARAMS[k]}`);
    }
    assert.equal(d.slots[0][DC.VOL], v3[DC.VOL]);
  }
  const named = decodeDreamcatcher(encodeDreamcatcher({ last: 0, slots, names: ["Glass Pad", "ignored: empty slot", "", "Velvet Dusk2 and more", "", "", "", ""] }, 4));
  assert.deepEqual(named.names, ["Glass Pad", "", "", "Velvet Dusk2", "", "", "", ""], "12 characters at most; empty slots have no name");
  assert.deepEqual(decodeDreamcatcher(encodeDreamcatcher({ last: 0, slots, names: ["x"] }, 3)).names, Array(8).fill(""), "version 3 has no names");
  assert.equal(dcName("Ünïcode\ttab  "), "ncodetab", "printable ASCII only, no trailing spaces");
  assert.equal(decodeDreamcatcher(new Uint8Array(100)), null);
  assert.equal(dcValues(Array(20).fill(3))[DC.ID.reverbMix], 0);
  assert.equal(dcValues(Array(35).fill(3))[DC.ID.reverbMix], 3);
  assert.equal(dcValues(Array(21).fill(3)), null);
});

test("an older backup's 20-value presets are read as 35", async () => {
  const values = DC.DEFAULTS.slice(0, 19).concat([200]);
  const b = { format: FORMAT, version: 1, firmware: { kind: "dreamcatcher" }, parts: [
    { kind: "dreamcatcher-presets", last: 1, slots: [{ slot: 1, values }, ...Array.from({ length: 7 }, (_, i) => ({ slot: i + 2, values: null }))] }] };
  const r = await parseBackup(new TextEncoder().encode(JSON.stringify(b)));
  const p = r.backup.parts.find((x) => x.kind === "dreamcatcher-presets");
  assert.ok(!p.bad, JSON.stringify(r.problems));
  assert.equal(p.slots[0].values.length, 35); assert.equal(p.slots[0].values[DC.VOL], 200); assert.equal(p.slots[0].values[DC.ID.reverbMix], 0);
});

test("live settings on a Dreamcatcher with platform 0.5.4 (simulated)", async () => {
  const p = new SimPedal({ firmware: "dreamcatcher", identity: true, platform: "0.5.4" });
  const link = await p.open((await locate(p)).name);
  assert.equal((await identify(link)).kind, "dreamcatcher");
  const all = await paramsRead(link, 0, 60);
  assert.equal(all.length, DC.VOL, "reads stop where the settings end");
  assert.deepEqual(all, DC.DEFAULTS.slice(0, DC.VOL));
  assert.equal(await paramSet(link, DC.ID.mix, 222), true);
  assert.equal(await paramSet(link, DC.ID.reverbMix, 999), true);
  assert.equal(await paramSet(link, DC.ID.catch, 1), false, "the loop is the foot's");
  assert.deepEqual((await paramsRead(link, DC.ID.mix, 1)), [222]);
  assert.deepEqual((await paramsRead(link, DC.ID.reverbMix, 1)), [255]);
  assert.equal(await paramSet(link, DC.P.PRESET, 2), false, "an empty slot doesn't load");
  assert.equal(await paramSet(link, DC.P.SAVE, 2), true);
  assert.deepEqual(await paramsRead(link, DC.P.VOLUME, 4), [255, 2, 4, 0]);       // volume, preset, used, changed
  const d = decodeDreamcatcher(latest(await readStore(link)).get(IDS.dreamcatcher).data);
  assert.equal(d.version, 4); assert.equal(d.last, 2); assert.equal(d.slots[2][DC.ID.mix], 222);
  assert.deepEqual(await paramsRead(link, DC.P.FORMAT, 1), [4], "the firmware says it keeps names");
  await paramSet(link, DC.ID.mix, 10);
  assert.deepEqual(await paramsRead(link, DC.P.CHANGED, 1), [1]);
  assert.equal(await paramSet(link, DC.P.PRESET, 2), true);
  assert.deepEqual(await paramsRead(link, DC.ID.mix, 1), [222]);
});

test("no live settings on older platforms or other firmwares", async () => {
  const old = new SimPedal({ firmware: "dreamcatcher", identity: true, platform: "0.5.3" });
  const l1 = await old.open((await locate(old)).name);
  assert.equal(await paramsRead(l1, 0, 1, 150), null);
  const nam = new SimPedal({ firmware: "nam", identity: true, platform: "0.5.4" });
  const l2 = await nam.open((await locate(nam)).name);
  assert.deepEqual(await paramsRead(l2, 0, 1), []);
});
