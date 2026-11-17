// convertNam's switches: calibrate (input) and level (output loudness), both on unless set false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertNam } from "../src/lib/gp5nam.js";

const NAM = fileURLToPath(new URL("../src/_dev/jcm.nam", import.meta.url));

test("convertNam: level and calibrate switches", { skip: !existsSync(NAM) && "no sample capture here" }, () => {
  const t = readFileSync(NAM, "utf8"), on = convertNam(t, "x"), off = convertNam(t, "x", { level: false, calibrate: false });
  assert.notEqual(on.levelDb, 0);
  assert.equal(off.levelDb, 0); assert.equal(off.gainDb, 0);
  assert.notDeepEqual([...on.blob], [...off.blob]);
  assert.deepEqual([...convertNam(t, "x", { level: true, calibrate: true }).blob], [...on.blob]);
});
