// The cab IR converter (lib/cabir.js) against NAM Loader's tools/make_cab.py (a NAM-Loader clone next to this one): the same file from the same samples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCabFile, cabInfo, cabNameBytes, cabToCab2, CAB_TAPS } from "../src/lib/cabir.js";

const PY = fileURLToPath(new URL("../../../fw-build/pyenv/bin/python3", import.meta.url));
const MAKE = fileURLToPath(new URL("../../NAM-Loader/tools/make_cab.py", import.meta.url));
const HAVE_PY = existsSync(PY) && existsSync(MAKE);   /* the OpenGP5 tree only (not in the public Launchpad repo) */

function wav48(samples) {                  // mono float32 WAV at 48 kHz
  const n = samples.length, b = new ArrayBuffer(44 + 4 * n), v = new DataView(b), s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + 4 * n, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 3, true);
  v.setUint16(22, 1, true); v.setUint32(24, 48000, true); v.setUint32(28, 192000, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  s(36, "data"); v.setUint32(40, 4 * n, true);
  for (let i = 0; i < n; i++) v.setFloat32(44 + 4 * i, samples[i], true);
  return new Uint8Array(b);
}

test("cab file: the same taps as make_cab.py (a resonant made-up IR, longer than 1024 taps)", { skip: !HAVE_PY && "no Python converter here" }, () => {
  const d = mkdtempSync(join(tmpdir(), "cab-")), n = 3000, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.exp(-i / 300) * (Math.sin(i * 0.017) + 0.5 * Math.sin(i * 0.11 + 1)) * 0.6;
  writeFileSync(join(d, "ir.wav"), wav48(x));
  execFileSync(PY, [MAKE, join(d, "ir.wav"), join(d, "ir.cab"), "--taps", String(CAB_TAPS)]);
  const py = readFileSync(join(d, "ir.cab")), js = makeCabFile(Float64Array.from(x), "Test IR", { format: 1 });
  assert.equal(py.length, 16 + 4 * CAB_TAPS);
  assert.deepEqual([...js.subarray(0, 16)], [...py.subarray(0, 16)], "header");
  const a = new Float32Array(py.buffer.slice(py.byteOffset + 16, py.byteOffset + py.length)), b = new Float32Array(js.buffer.slice(16, 16 + 4 * CAB_TAPS));
  let worst = 0;
  for (let i = 0; i < CAB_TAPS; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / (Math.abs(a[i]) + 1e-30));
  assert.ok(worst < 1e-6, `taps differ by ${worst}`);
  assert.deepEqual(cabInfo(js.subarray(0, 16), js.subarray(16 + 4 * CAB_TAPS)), { taps: CAB_TAPS, format: 1, tapBytes: 4 * CAB_TAPS, name: "Test IR" });
  assert.equal(js.length, 16 + 4 * CAB_TAPS + cabNameBytes);
});

test("cab file: a short IR keeps its length and its name", () => {
  const x = new Float64Array(300); x[0] = 1; x[5] = 0.8; x[9] = -0.5;
  const f = makeCabFile(x, "short"), info = cabInfo(f.subarray(0, 16), f.subarray(16 + 2 * 300));
  assert.equal(info.taps, 300); assert.equal(info.name, "short"); assert.equal(info.format, 2);
});

// the 16-bit format (NAM Loader 1.3): one storage sector, the same IR to far below hearing
function taps(f) {
  const dv = new DataView(f.buffer, f.byteOffset, f.byteLength), n = dv.getUint32(4, true), m = dv.getUint32(0, true);
  return Float64Array.from({ length: n }, (_, i) => m === 0x31424143 ? dv.getFloat32(16 + 4 * i, true) : dv.getInt16(16 + 2 * i, true) * dv.getFloat32(12, true));
}
test("cab file: CAB2 fits one storage sector and matches the float IR to below -85 dB (the pedal plays it in 16 bits anyway)", () => {
  const n = 3000, x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.exp(-i / 300) * (Math.sin(i * 0.017) + 0.5 * Math.sin(i * 0.11 + 1)) * 0.6;
  const f1 = makeCabFile(x, "Orange", { format: 1 }), f2 = makeCabFile(x, "Orange");
  assert.ok(64 + f2.length <= 4096, `${f2.length} bytes`);
  const a = taps(f1), b = taps(f2);
  let e = 0, s = 0;
  for (let i = 0; i < a.length; i++) { e += (a[i] - b[i]) ** 2; s += a[i] ** 2; }
  assert.ok(10 * Math.log10(e / s) < -85, `error ${(10 * Math.log10(e / s)).toFixed(1)} dB`);
  assert.equal(cabInfo(f2.subarray(0, 16), f2.subarray(16 + 2 * CAB_TAPS)).name, "Orange");
  assert.deepEqual([...cabToCab2(f1)], [...f2], "an old file converts to the same CAB2 file");
  assert.equal(cabToCab2(f2), f2);
});
