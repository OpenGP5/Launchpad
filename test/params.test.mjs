// lib/params.js: a 7E 12 reply into a description; values shown by unit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDescription, formatValue, FLAG, UNIT } from "../src/lib/params.js";

const reply = (id, count, flags, unit, min, max, def, name, group, choices = "") => {
  const s = (v) => [v & 0xFF, (v >> 8) & 0xFF], t = (x) => [...new TextEncoder().encode(x), 0];
  return new Uint8Array([0x7E, 0x12, 1, ...s(count), ...s(id), flags, unit, ...s(min), ...s(max), ...s(def), ...t(name), ...t(group), ...t(choices)]);
};

test("a number and a choice, described", () => {
  const a = parseDescription(reply(0, 4, FLAG.DSP | FLAG.PRESET, UNIT.CUSTOM, 50, 1500, 500, "Rate", "Tremolo"));
  assert.deepEqual(a, { count: 4, id: 0, flags: 3, unit: UNIT.CUSTOM, min: 50, max: 1500, def: 500, name: "Rate", group: "Tremolo", choices: null });
  const b = parseDescription(reply(2, 4, FLAG.DSP | FLAG.CHOICE, 0, 0, 2, 0, "Shape", "Tremolo", "Sine|Triangle|Square"));
  assert.deepEqual(b.choices, ["Sine", "Triangle", "Square"]);
  const c = parseDescription(reply(3, 4, FLAG.READONLY, UNIT.CENTS10, -500, 500, -3, "Cents", "Reading"));
  assert.equal(c.min, -500); assert.equal(c.def, -3);
  assert.equal(parseDescription(new Uint8Array([0x7E, 0x12, 0])), null, "past the last one");
});

test("values shown by unit", () => {
  const d = (unit, extra = {}) => ({ unit, choices: null, ...extra });
  assert.equal(formatValue(d(UNIT.PERCENT), 55), "55 %");
  assert.equal(formatValue(d(UNIT.DB10), -35), "−3.5 dB");
  assert.equal(formatValue(d(UNIT.DB10), 120), "+12 dB");
  assert.equal(formatValue(d(UNIT.MS), 350), "350 ms");
  assert.equal(formatValue(d(UNIT.MS), 1500), "1.50 s");
  assert.equal(formatValue(d(UNIT.SEMITONES), -7), "−7 st");
  assert.equal(formatValue(d(UNIT.CENTS10), 13), "+1.3 cents");
  assert.equal(formatValue(d(UNIT.NONE, { choices: ["Off", "On"] }), 1), "On");
});
