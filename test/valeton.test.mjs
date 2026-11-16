// Downloading Valeton's firmware (valeton.cjs) with a fake download: only the known file is accepted and kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { deflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { stockFirmware, unzip } = require("../valeton.cjs");

function zip(entries) {                       // a minimal zip writer (deflate), enough for these tests
  const locals = [], central = []; let off = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name), c = deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034B50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(c.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014B50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(8, 10);
    d.writeUInt32LE(crc, 16); d.writeUInt32LE(c.length, 20); d.writeUInt32LE(data.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(off, 42);
    locals.push(h, n, c); central.push(d, n); off += 30 + n.length + c.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054B50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const fw = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) & 255));
const known = { "1.0.6": { url: "https://www.valeton.net/x.zip", hosts: ["www.valeton.net", "res.valeton.net"], name: "GP-5_USB_V1.0.6_test.bin",
  size: fw.length, sha256: createHash("sha256").update(fw).digest("hex") } };
const fake = (body, { status = 200, url = "https://res.valeton.net/a.zip" } = {}) => {
  const calls = [];
  const f = async (u) => { calls.push(u); return { ok: status === 200, status, url, headers: new Map([["content-length", String(body.length)]]), arrayBuffer: async () => body }; };
  f.calls = calls; return f;
};

test("unzip reads deflated entries", () => {
  const files = unzip(zip([{ name: "readme.txt", data: Buffer.from("hi") }, { name: "fw.bin", data: fw }]));
  assert.deepEqual(files.map((f) => f.name), ["readme.txt", "fw.bin"]);
  assert.ok(files[1].data.equals(fw));
});

test("the known firmware is taken from the download and kept; next time no download", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-v-")), f = fake(zip([{ name: "GP-5 Firmware V1.0.6/GP-5.bin", data: fw }]));
  const r = await stockFirmware({ cacheDir: dir, fetchFn: f, known });
  assert.equal(r.downloaded, true);
  assert.ok(Buffer.from(r.bytes).equals(fw));
  assert.ok(existsSync(join(dir, known["1.0.6"].name)));
  const again = await stockFirmware({ cacheDir: dir, fetchFn: f, known });
  assert.equal(again.downloaded, false);
  assert.equal(f.calls.length, 1);
  assert.equal(await stockFirmware({ cacheDir: mkdtempSync(join(tmpdir(), "lp-v-")), fetchFn: f, known, download: false }), null);
});

test("a changed file, another site, an error or a non-zip is refused and nothing is kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-v-")), other = Buffer.from(fw); other[10] ^= 1;
  await assert.rejects(stockFirmware({ cacheDir: dir, fetchFn: fake(zip([{ name: "a.bin", data: other }])), known }), /doesn't contain/);
  await assert.rejects(stockFirmware({ cacheDir: dir, fetchFn: fake(zip([{ name: "a.bin", data: fw }]), { url: "https://evil.example/a.zip" }), known }), /unexpected site/);
  await assert.rejects(stockFirmware({ cacheDir: dir, fetchFn: fake(Buffer.alloc(0), { status: 404 }), known }), /answered 404/);
  await assert.rejects(stockFirmware({ cacheDir: dir, fetchFn: fake(Buffer.from("<html>")), known }), /readable zip/);
  assert.equal(existsSync(join(dir, known["1.0.6"].name)), false);
});
