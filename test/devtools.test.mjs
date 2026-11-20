// The developer commands (platform 0.7: the log 7E 18, load and memory 7E 14) against the simulated pedal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimPedal, fastTiming } from "../src/lib/sim.js";
import { locate } from "../src/lib/device.js";
import { readLog, readStatus, share, parseStatus } from "../src/lib/devtools.js";

fastTiming();
const open = async (opts) => { const p = new SimPedal(opts); return { p, link: await p.open((await locate(p)).name) }; };

test("reads the log from the start, then only what's new", async () => {
  const { p, link } = await open({ firmware: "nam", identity: true, platform: "0.7.0" });
  const a = await readLog(link, 0);
  assert.match(a.text, /OpenGP5 0\.7\.0, firmware nam/);
  assert.match(a.text, /\] dsp: firmware nam/);
  assert.equal(a.lost, 0);
  const b = await readLog(link, a.next);
  assert.equal(b.text, "");                                     // nothing new yet
  p.logLine("a line of the firmware's own");
  const c = await readLog(link, a.next);
  assert.match(c.text, /a line of the firmware's own\n$/);
});

test("says how much was lost when the pedal overwrote the log before it was read", async () => {
  const { p, link } = await open({ firmware: "nam", identity: true, platform: "0.7.0" });
  const first = await readLog(link, 0);
  for (let i = 0; i < 200; i++) p.logLine(`line ${i} ${"x".repeat(30)}`);   // far more than 4 KB
  const r = await readLog(link, first.next, 200);
  assert.ok(r.lost > 0);
  assert.match(r.text, /line 199 x+\n$/);
});

test("the load report, and resetting the worst values", async () => {
  const { link } = await open({ firmware: "nam", identity: true, platform: "0.7.0" });
  const s = await readStatus(link);
  assert.equal(s.ctl.block, 417920);
  assert.ok(share(s.ctl.linkWorst, s.ctl.block) > 0.5 && share(s.ctl.linkWorst, s.ctl.block) < 1);
  assert.equal(s.dsp.varsTotal, 19968);
  const r = await readStatus(link, true);
  assert.ok(r.ctl.linkWorst <= s.ctl.linkWorst + 6000);
});

test("a platform before 0.7 has neither", async () => {
  const { link } = await open({ firmware: "nam", identity: true, platform: "0.6.0" });
  assert.equal(await readLog(link, 0), null);
  assert.equal(await readStatus(link), null);
});

test("a DSP that didn't answer is reported as such", () => {
  const v = [417920, 1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = [0x7E, 0x14, 1, ...v.flatMap((x) => [x & 255, (x >> 8) & 255, (x >> 16) & 255, x >>> 24])];
  assert.equal(parseStatus(r).dsp, null);
});
