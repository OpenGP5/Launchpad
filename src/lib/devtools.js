// For firmware developers (OpenGP5 platform 0.7 and later; docs/platform/protocols.md): the log and the load report.
//   7E 18 <from u32>  ->  7E 18 1 <at u32> <end u32> <n> <n bytes>     the log ring (gp5_log on both processors)
//   7E 14 [1]         ->  7E 14 1 <15 u32>                              load and memory of both processors (1: reset worst)
import { cmd } from "./device.js";

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The log from byte `from` on: { text, next, lost } (lost: bytes overwritten before they were read), or null when
 * the firmware has no log (a platform before 0.7). Reads at most `chunks` replies (48 bytes each). */
export async function readLog(link, from, chunks = 40) {
  let pos = from >>> 0, text = "", lost = 0;
  for (let i = 0; i < chunks; i++) {
    const r = await cmd(link, [0x7E, 0x18, pos & 0xFF, (pos >>> 8) & 0xFF, (pos >>> 16) & 0xFF, (pos >>> 24) & 0xFF], 400);
    if (!r || r.length < 12 || r[2] !== 1) return i ? { text, next: pos, lost } : null;
    const at = u32(r, 3), end = u32(r, 7), n = r[11];
    if (at > pos) lost += at - pos;
    text += new TextDecoder().decode(r.subarray(12, 12 + n));
    pos = at + n;
    if (pos >= end || !n) break;
  }
  return { text, next: pos, lost };
}

/** Load and memory of both processors, or null (a platform before 0.7). reset: start the worst values again. */
export async function readStatus(link, reset = false) {
  const r = await cmd(link, reset ? [0x7E, 0x14, 1] : [0x7E, 0x14], 600);
  if (!r || r.length < 63 || r[2] !== 1) return null;
  return parseStatus(r);
}

export function parseStatus(r) {
  const v = Array.from({ length: 15 }, (_, k) => u32(r, 3 + 4 * k));
  return {
    ctl: { block: v[0], linkLast: v[1], linkWorst: v[2], loopWorst: v[3], ramUsed: v[4], ramTotal: v[5] },
    dsp: v[6] ? { block: v[7], last: v[8], worst: v[9], late: v[10], varsUsed: v[11], varsTotal: v[12], largeUsed: v[13], largeTotal: v[14] } : null,
  };
}

/** a share of a block, 0..1+ */
export const share = (cycles, block) => (block ? cycles / block : 0);
