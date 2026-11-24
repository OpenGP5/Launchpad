import { test } from "node:test";
import assert from "node:assert/strict";
import { SimPedal } from "../src/lib/sim.js";
import { MODE_STOCK } from "../src/lib/gp5flash.js";
import { decodeDeviceId, setLanguage } from "../src/lib/stocklanguage.js";

async function pedal() {
  const sim = new SimPedal({ mode: MODE_STOCK });
  return { sim, link: await sim.open((await sim.names())[0]) };
}

test("language settings use stock USB-MIDI without flashing firmware or presets", async () => {
  const { sim, link } = await pedal();
  const writes = sim.stock.flashWrites;
  for (const [mode, code, display] of [["en", "0001", "en"], ["zh", "0002", "zh"], ["both", "0003", "zh"]]) {
    const result = await setLanguage(link, mode);
    assert.equal(sim.stock.unlockedLanguages, code);
    assert.equal(result.after, display);
  }
  assert.equal(sim.stock.flashWrites, writes);
  assert.equal(sim.stock.log.filter((entry) => entry === "11 33").length, 3);
  await link.close();
});

test("language settings refuse unknown firmware and malformed Device IDs", async () => {
  const { sim, link } = await pedal();
  sim.stock.firmware = 0x01010007;
  await assert.rejects(setLanguage(link, "both"), /only supported.*V1\.0\.6/);
  assert.equal(sim.stock.log.includes("11 33"), false);
  sim.stock.firmware = 0x01010006;
  sim.stock.deviceId = "not-a-device-id";
  await assert.rejects(setLanguage(link, "both"), /unexpected Device ID/);
  assert.equal(sim.stock.log.includes("11 33"), false);
  assert.throws(() => decodeDeviceId(Uint8Array.from([0x12, 0x32, 0, 0])), /invalid|incomplete/);
  await link.close();
});

test("Device ID decoding accepts a complete ID with reply padding or an oversized length field", () => {
  const id = "1d11190808090505";
  const key = Uint8Array.from(id, (ch) => ch.charCodeAt(0));
  const blob = Uint8Array.from([key.length, ...key, ...new Uint8Array(key.length)]);
  assert.equal(decodeDeviceId(Uint8Array.from([0x12, 0x32, blob.length, 0, ...blob, 0, 0])), id);
  assert.equal(decodeDeviceId(Uint8Array.from([0x12, 0x32, blob.length + 2, 0, ...blob])), id);
});
