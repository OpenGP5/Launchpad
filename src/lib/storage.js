// Who owns the pedal's storage, and changing hands (docs/platform/storage.md, platform 0.5): the storage area
// (0x13F000 .. 0x189FFF) belongs to the installed firmware. Switching firmware wipes it; switching to Valeton's
// firmware also leaves Valeton's preset area as Valeton expects it (erased presets = factory ones, and its
// preset order table 0, 1, .. 99, without which saving presets on stock silently does nothing).
import { inspect } from "./gp5flash.js";
import { parseMeta, kindOf } from "./fwmeta.js";
import { cmd, FIRMWARES } from "./device.js";
import { flashRead } from "./gp5nam.js";

export const AREA = 0x13F000, AREA_END = 0x18A000, SECTOR = 0x1000, VALETON_PRESETS = 0x170000;
const le32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

function findText(bytes, text) {
  const t = new TextEncoder().encode(text);
  outer: for (let i = 0; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

// What a firmware image installs: { kind: "stock" | "nam" | "dreamcatcher" | "tuner" | "opengp5" | null, title,
// platform }. null: an image without an app section (DSP only), which changes no ownership.
export function imageKind(bytes) {
  const { sections, lines } = inspect(bytes);
  const app = sections.find(([t]) => t === 0x62);
  if (!app) return { kind: null, title: "this image", platform: null };
  const code = app[1], meta = parseMeta(code);
  if (meta) return { kind: kindOf(meta.id), title: meta.name, version: meta.version, meta, platform: meta.built_on || null };
  const v = findText(code, "OPENGP5 ");
  if (v < 0) return { kind: "stock", title: lines.find((l) => l.type === 0x62)?.stock ? "Valeton's firmware" : "a Valeton-based firmware", platform: null };
  const platform = new TextDecoder().decode(code.subarray(v + 8, v + 20)).split("\0")[0];
  for (const [kind, f] of Object.entries(FIRMWARES))
    if (f.marks.length && f.marks.every((m) => findText(code, m) >= 0)) return { kind, title: f.title, platform };
  return { kind: "opengp5", title: FIRMWARES.opengp5.title, platform };
}

// The pedal's current owner, from what Launchpad knows: a kind, or null (update mode, not answering, unknown)
export function currentKind(pedal) {
  if (!pedal) return null;
  if (pedal.mode === "stock firmware") return "stock";
  if (pedal.mode === "open firmware") return pedal.firmware?.kind ?? null;
  return null;
}

// Wipe the storage area through the running OpenGP5 platform: erase every sector it lets us erase (older platforms
// allow less; their firmwares never used more). forStock: also write Valeton's order table.
// Returns { erased, refused, valetonReady? }. progress(fraction)
export async function wipeStorage(link, { forStock = false } = {}, progress = () => {}) {
  let erased = 0, refused = 0;
  const n = (AREA_END - AREA) / SECTOR;
  for (let i = 0; i < n; i++) {
    const r = await cmd(link, [0x7E, 0x07, ...le32(AREA + i * SECTOR)], 5000);
    if (r && r.length >= 3 && r[2]) erased++; else refused++;
    progress((i + 1) / n);
  }
  if (forStock) {
    const map = new Uint8Array(100).map((_, i) => i);
    const r0 = await cmd(link, [0x7E, 0x07, ...le32(VALETON_PRESETS)], 5000);
    let ok = !!(r0 && r0[2]);
    for (let i = 0; ok && i < 100; i += 52) {
      const part = map.subarray(i, i + 52), padded = new Uint8Array((part.length + 3) & ~3).fill(0xFF); padded.set(part);
      const r = await cmd(link, [0x7E, 0x08, ...le32(VALETON_PRESETS + i), ...padded], 2000);
      ok = !!(r && r[2]);
    }
    if (ok) {
      const back = await flashRead(link, VALETON_PRESETS, 100);
      ok = back.every((v, i) => v === i);
    }
    return { erased, refused, valetonReady: ok };
  }
  return { erased, refused };
}
