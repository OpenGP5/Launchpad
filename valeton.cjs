// Valeton's stock firmware, fetched from Valeton's own site on the user's request and kept on this computer
// (never shipped with Launchpad). The download is a zip; the firmware inside is accepted only if it is exactly the
// file Launchpad knows (SHA-256), so a changed or damaged download is never used for mods, undo or flashing.
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const KNOWN = {
  "1.0.6": {
    url: "https://www.valeton.net/download/165/gp-5/19669/gp-5-firmware-v1-0-6-zip%ef%bc%88compatible-with-mobile-phone-software-v1-0-4%ef%bc%89.zip",
    hosts: ["www.valeton.net", "res.valeton.net"],
    name: "GP-5_USB_V1.0.6_20250626.bin",
    size: 2094404,
    sha256: "259ac4e77d3df792ff48e55feff52427ff2ea9ed63cb65785360a23a10dbaf42",
  },
};
const MAX_ZIP = 16 * 1024 * 1024;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// The files in a zip: [{ name, data }] (stored or deflated entries; from the central directory).
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000 - 22); i--) if (buf.readUInt32LE(i) === 0x06054B50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10), out = [];
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014B50) throw new Error("damaged zip directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    if (buf.readUInt32LE(loc) !== 0x04034B50) throw new Error("damaged zip entry");
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28), raw = buf.subarray(start, start + csize);
    if (usize > 64 * 1024 * 1024) continue;
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 }) : null;
    if (data && data.length === usize) out.push({ name, data });
  }
  return out;
}

// The firmware from the cache, or downloaded now. { name, bytes, downloaded }. fetchFn: Electron's net.fetch.
async function stockFirmware({ version = "1.0.6", cacheDir, fetchFn = fetch, download = true, known = KNOWN }) {
  const k = known[version];
  if (!k) throw new Error(`Launchpad doesn't know Valeton's firmware V${version}.`);
  const cached = path.join(cacheDir, k.name);
  try {
    const b = await fs.readFile(cached);
    if (b.length === k.size && sha(b) === k.sha256) return { name: k.name, bytes: new Uint8Array(b), downloaded: false };
    await fs.rm(cached, { force: true });                       // damaged copy: fetch again
  } catch { /* not there yet */ }
  if (!download) return null;
  let zip;
  try {
    const r = await fetchFn(k.url, { redirect: "follow", headers: { "User-Agent": "OpenGP5-Launchpad" } });
    if (!r.ok) throw new Error(`Valeton's site answered ${r.status}.`);
    const host = new URL(r.url || k.url).hostname;
    if (!k.hosts.includes(host)) throw new Error(`The download went to an unexpected site (${host}).`);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_ZIP) throw new Error("The download is far bigger than Valeton's firmware.");
    zip = Buffer.from(await r.arrayBuffer());
    if (zip.length > MAX_ZIP) throw new Error("The download is far bigger than Valeton's firmware.");
  } catch (e) {
    throw new Error(`Couldn't download Valeton's firmware: ${e.message || e}. Check the internet connection, or choose the file yourself.`);
  }
  let files;
  try { files = unzip(zip); } catch (e) { throw new Error(`Valeton's download isn't a readable zip (${e.message}).`); }
  const fw = files.find((f) => f.data.length === k.size && sha(f.data) === k.sha256);
  if (!fw) throw new Error(`Valeton's download doesn't contain the V${version} firmware Launchpad knows (the file on their site may have changed). Nothing was used.`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cached + ".part", fw.data);
  await fs.rename(cached + ".part", cached);
  return { name: k.name, bytes: new Uint8Array(fw.data), downloaded: true };
}

module.exports = { stockFirmware, unzip, KNOWN };
