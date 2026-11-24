// The pedal over Bluetooth MIDI ("GP-5 Bluetooth", OpenGP5 1.0): found as the open firmware, USB preferred,
// never probed as Valeton's firmware, never flashed.
import test from "node:test";
import assert from "node:assert/strict";
import { find, isBluetooth, flash, options, MODE_OPEN } from "../src/lib/gp5flash.js";

const ports = (names, opened = []) => ({
  async names() { return names; },
  async open(n) { opened.push(n); return { async send() {}, async recv() { return null; }, flush() {}, async close() {} }; },
});

test("the Bluetooth port is the open firmware, and USB wins when both are there", async () => {
  assert.deepEqual(await find(ports(["GP-5 Bluetooth"])), ["GP-5 Bluetooth", MODE_OPEN]);
  assert.deepEqual(await find(ports(["GP-5 Bluetooth", "GP-5 Open FW"])), ["GP-5 Open FW", MODE_OPEN]);
  assert.ok(isBluetooth("GP-5 Bluetooth") && !isBluetooth("GP-5 Open FW") && !isBluetooth(null));
});

test("bluetoothFirst (testing, USB-powered pedal): the Bluetooth port wins over USB", async () => {
  options.bluetoothFirst = true;
  try {
    assert.deepEqual(await find(ports(["GP-5 Bluetooth", "GP-5 Open FW"])), ["GP-5 Bluetooth", MODE_OPEN]);
    assert.deepEqual(await find(ports(["GP-5 Open FW"])), ["GP-5 Open FW", MODE_OPEN]);
  } finally { options.bluetoothFirst = false; }
});

test("the Bluetooth port is never probed as Valeton's firmware", async () => {
  const opened = [];
  await find(ports(["GP-5 Bluetooth"], opened));
  assert.deepEqual(opened, []);
});

test("no firmware update over Bluetooth", async () => {
  await assert.rejects(() => flash(ports(["GP-5 Bluetooth"]), [], () => {}, () => {}), /needs USB/);
});

test("over Bluetooth, identify asks again instead of scanning the code", async () => {
  const { identify } = await import("../src/lib/device.js");
  const { buildSysex, CLASS_CMD } = await import("../src/lib/gp5flash.js");
  let asked = 0, flashReads = 0;
  const reply = (pl) => buildSysex(CLASS_CMD, 0, pl);
  const name = [...new TextEncoder().encode("dreamcatcher"), 0];
  const queue = [];
  const link = {
    bluetooth: true, flush() { queue.length = 0; },
    async send(bytes) {
      const b = Array.from(bytes), body = [];
      for (let i = 1; i + 1 < b.length - 1; i += 2) body.push((b[i] << 4) | b[i + 1]);
      const pl = body.slice(4);
      if (pl[0] === 0x7E && pl[1] === 0x0D) { asked++; if (asked >= 3) queue.push(reply([0x7E, 0x0D, 1, 0, 8, 0, ...name])); }
      if (pl[0] === 0x7E && pl[1] === 0x05) flashReads++;
    },
    async recv() { return queue.length ? queue.shift() : null; },
  };
  const fw = await identify(link);
  assert.equal(fw.kind, "dreamcatcher");
  assert.equal(flashReads, 0);
  assert.ok(asked >= 3);
});
