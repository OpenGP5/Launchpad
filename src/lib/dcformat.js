// Dreamcatcher's settings as the pedal shows them: sections, names and the value texts, ported from its
// nds32/controls.c (the same integer maths, so Launchpad shows exactly what the pedal's screen does).
// Values are Launchpad's 35 (DC.PARAMS: the 34 settings in params.h order, then VOLUME).
import { DC } from "./gp5store.js";

// Section colours as on the pedal's screen (its nds32/ui.c)
export const SECTIONS = [
  { name: "MAIN", c: "#ceb6ff" }, { name: "WET", c: "#9664ff" }, { name: "GRAIN", c: "#ba78ff" }, { name: "MOD", c: "#e268da" },
  { name: "COLOR", c: "#7480ff" }, { name: "LOOP", c: "#ff78be" }, { name: "REVERB", c: "#a0c4ff" },
];

// The settings, in the pedal's order (its item table; PRESET is Launchpad's preset row instead). n: number of values.
// choices: shown as buttons rather than a slider.
const S = (name, sec, key, n, choices) => ({ name, sec, key, n, choices });
export const ITEMS = [
  S("MIX", 0, "mix", 256), S("CLOCK", 0, "clock", 11), S("VOLUME", 0, "volume", 256),
  S("TIME", 1, "time", 256), S("SMEAR", 1, "smear", 256), S("TONE", 1, "tone", 256), S("CHANCE", 1, "chance", 256), S("GLITCH", 1, "glitch", 256),
  S("GRAIN", 2, "grain", 256), S("PITCH", 2, "pitch", 256), S("SCALE", 2, "scale", 5, ["OCT UP", "OCT DN", "OCTAVES", "5TH+OCT", "HARMONY"]),
  S("REVERSE", 2, "reverse", 256), S("STUTTER", 2, "stutter", 256),
  S("RATE", 3, "rate", 256), S("DEPTH", 3, "depth", 256),
  S("SHAPE", 3, "shape", 7, ["SINE", "SQUARE", "RAMP", "SAW", "RND SIN", "RND SQR", "ENV"]), S("MOD", 3, "modType", 2, ["TREMOLO", "VIBRATO"]),
  S("DISSOLVE", 4, "dissolve", 256), S("FILTER", 4, "filter", 256),
  S("MODE", 5, "loopMode", 2, ["TAPE", "STRETCH"]), S("LENGTH", 5, "length", 256), S("SPEED", 5, "motion", 256),
  S("LOOP LV", 5, "loopLevel", 256), S("FADE", 5, "fade", 256), S("ROUTE", 5, "route", 3, ["IN", "IN+LOOP", "LOOP"]),
  S("DECAY", 6, "reverbDecay", 256), S("MIX", 6, "reverbMix", 256), S("SIZE", 6, "reverbSize", 256),
  S("PRE-DLY", 6, "reverbPredelay", 256), S("MOD", 6, "reverbMod", 256), S("SHIMMER", 6, "reverbShimmer", 256),
];

// The live id of a setting (OpenGP5 0.5.4, 7E 10 / 7E 11): its index in params.h, or DC.P.VOLUME
export const liveId = (key) => (key === "volume" ? DC.P.VOLUME : DC.ID[key]);

const CLK_NAME = ["1.4K", "2.1K", "2.8K", "4.1K", "5.5K", "8.3K", "11K", "17K", "22K", "33K", "44K"];
const CLK_NUM = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1], CLK_DEN = [32, 64, 16, 32, 8, 16, 4, 8, 2, 4, 1];
const TAPE = ["REV 4X", "REV 2X", "REV 1X", "REV.5X", "0.5X", "1X", "2X", "4X"];

// base * 2^(x / 65536), as the pedal computes it
export function exp2q(base, x) {
  const i = x >>> 16, f = x & 0xFFFF;
  const m = 65536 + Math.floor((f * (43024 + Math.floor((22512 * f) / 65536))) / 65536);
  return Math.floor(((base << i) * m) / 65536);
}
const pct = (v, full) => `${Math.floor((v * 100 + Math.floor(full / 2)) / full)}%`;
function msAtClock(samples, clock) {
  const ms = Math.floor(Math.floor(Math.floor((samples * 1000) / CLK_NUM[clock]) * CLK_DEN[clock]) / 44100);
  if (ms < 1000) return `${ms}MS`;
  if (ms < 10000) return `${Math.floor(ms / 1000)}.${Math.floor(ms / 100) % 10}S`;
  return `${Math.floor(ms / 1000)}S`;
}
function hz(f) {
  if (f < 1000) return `${f}`;
  return `${Math.floor(f / 1000)}${f < 10000 ? "." + (Math.floor(f / 100) % 10) : ""}K`;
}

// The name the pedal shows (two settings change with others)
export function itemName(it, v) {
  if (it.key === "motion") return v[DC.ID.loopMode] ? "DRIFT" : "SPEED";
  if (it.key === "chance" && v[DC.ID.shape] === 6) return "SENSE";
  return it.name;
}

// The value text the pedal shows for setting `key` at x, with the other settings in v
export function valueText(key, x, v) {
  const clock = v[DC.ID.clock];
  switch (key) {
    case "clock": return CLK_NAME[x] ?? "?";
    case "time": return msAtClock(Math.min(exp2q(200, x * 2056), 51136), clock);
    case "chance":
      if (v[DC.ID.shape] === 6) return pct(x, 255);
      if (x < 128) return pct(x, 128);
      return x === 128 ? "ALWAYS" : `FB ${pct(x - 128, 127)}`;
    case "glitch": return x < 43 ? "HALF" : x < 86 ? "NORMAL" : x < 128 ? "DOUBLE" : `RND ${pct(x - 128, 127)}`;
    case "rate": {
      const f = exp2q(5, x * 2032);
      return (f < 100 ? `0.${Math.floor(f / 10)}${f % 10}` : f < 1000 ? `${Math.floor(f / 100)}.${Math.floor(f / 10) % 10}` : `${Math.floor(f / 100)}`) + "HZ";
    }
    case "dissolve": {
      if (x < 120) return `LOFI ${Math.floor(((120 - x) * 100 + 60) / 120)}`;
      if (x <= 135) return "CLEAN";
      const st = Math.min(3, Math.floor((x - 136) / 30));
      return st ? `REV/${1 << st}` : "REV 1X";
    }
    case "filter":
      if (x < 120) return `LP ${hz(exp2q(150, x * 3517))}`;
      return x <= 135 ? "OPEN" : `HP ${hz(exp2q(20, (x - 136) * 3839))}`;
    case "length": return msAtClock(v[DC.ID.loopMode] ? exp2q(256, x * 1285) : exp2q(4060, x * 1028), clock);
    case "motion": {
      if (!v[DC.ID.loopMode]) return TAPE[x >> 5];
      const d = x - 128, a = Math.min(127, Math.abs(d));
      return a < 3 ? "FROZEN" : `${d < 0 ? "REV" : "FWD"} ${Math.floor((a * a * 100) / 16129)}%`;
    }
    case "grain": return msAtClock(exp2q(256, x * 1285), clock);
    case "pitch": case "reverse": case "stutter": case "reverbMod": case "reverbShimmer": return x ? pct(x, 255) : "OFF";
    case "tone": return x === 255 ? "OPEN" : pct(x, 255);
    case "fade": return x ? pct(x, 255) : "REPLACE";
    case "reverbDecay": {
      if (x >= 250) return "HOLD";
      const ms = exp2q(300, x * 1711);
      return ms < 1000 ? `${ms}MS` : ms < 10000 ? `${Math.floor(ms / 1000)}.${Math.floor(ms / 100) % 10}S` : `${Math.floor((ms + 500) / 1000)}S`;
    }
    case "reverbPredelay": return `${Math.floor((x * 200 + 127) / 255)}MS`;
    default: {
      const it = ITEMS.find((i) => i.key === key);
      if (it?.choices) return it.choices[x] ?? "?";
      return pct(x, 255);                                  // MIX, VOLUME, SMEAR, DEPTH, LOOP LV, reverb MIX / SIZE
    }
  }
}
