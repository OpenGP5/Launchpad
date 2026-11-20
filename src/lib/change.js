// Changing the pedal's firmware the Launchpad way (docs/platform/storage.md): the storage belongs to the installed
// firmware, so a different firmware starts with it empty. Asks first (with a backup offer), wipes through the
// running OpenGP5 platform before flashing (or, coming from Valeton's firmware, right after), and leaves Valeton's
// preset area ready when going back to stock.
import * as F from "./gp5flash.js";
import { imageKind, currentKind, wipeStorage } from "./storage.js";

const KIND_TITLE = { stock: "Valeton's firmware", nam: "NAM Loader", dreamcatcher: "Dreamcatcher", tuner: "Strobe tuner", opengp5: "OpenGP5 firmware" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sections: [[type, data]] to flash; imageBytes: the whole image (to tell what it installs), or target given.
// backupNow(): makes and saves a backup, true when saved. say(text), progress(name, done, total)
// Returns { mode, wiped } or null when cancelled.
export async function changeFirmware(ctx, { sections, imageBytes, target, backupNow, say, progress }) {
  const { state } = ctx;
  target ??= imageKind(imageBytes);
  const cur = currentKind(state.pedal);
  const changing = !!(target.kind && target.kind !== cur && (cur || state.pedal?.mode === F.MODE_STOCK));
  if (changing) {
    // say plainly what's lost, and offer a backup first (Valeton's presets and OpenGP5 data can both be backed up)
    const lost = cur === "stock" ? "Valeton's presets" : cur ? `everything ${KIND_TITLE[cur] || "the current firmware"} keeps on the pedal (tones, presets, settings)`
      : "the presets, tones and settings stored on the pedal";
    const back = target.kind === "stock" ? " Valeton's firmware comes back with its factory presets." : "";
    const canBackup = (state.pedal?.mode === F.MODE_OPEN || state.pedal?.mode === F.MODE_STOCK) && !!state.link;
    const snap = cur === "stock" ? "\n\nSnapTones and user IRs can't be backed up by Launchpad and may be lost: export them in Valeton Suite first if you want to keep them. Global settings stay on the pedal." : "";
    const answer = await ctx.choose(`Install ${target.title}?`,
      `Installing ${target.title} erases ${lost}.${back}${canBackup ? " Back them up first if you want them later." : ""}${snap}`,
      [{ value: "cancel", label: "Cancel" }, { value: "flash", label: "Erase and install", danger: true },
       ...(canBackup ? [{ value: "backup", label: "Back up first", primary: true }] : [])]);
    if (!answer || answer === "cancel") return null;
    if (answer === "backup" && !(await backupNow())) return null;
  }
  let wiped = false;
  if (changing && state.pedal?.mode === F.MODE_OPEN) {          // wipe now, while OpenGP5 can still do it
    say("Clearing the pedal's storage");
    const r = await ctx.withLink("Clearing storage", (link) => wipeStorage(link, { forStock: target.kind === "stock" }));
    say(`  ${r.erased} sectors cleared${r.refused ? ` (${r.refused} outside this platform's reach)` : ""}${target.kind === "stock" ? (r.valetonReady ? ", Valeton's preset table ready" : ", Valeton's preset table not written (older platform)") : ""}`);
    wiped = true;
  }
  const mode = await ctx.withPorts("Flashing", (ports) => F.flash(ports, sections, say, progress));
  if (changing && !wiped && cur === "stock" && target.kind !== "stock") {   // from stock: clear what Valeton left
    for (let k = 0; k < 40 && !(state.pedal?.mode === F.MODE_OPEN && state.pedal.firmware && state.link); k++) await sleep(500);
    if (state.pedal?.mode === F.MODE_OPEN && state.link) {
      say("Clearing what Valeton's firmware left in the storage");
      await ctx.withLink("Clearing storage", (link) => wipeStorage(link));
      wiped = true;
    } else say("The pedal didn't come back in time to clear its storage; the new firmware clears it at its next start.");
  }
  return { mode, wiped };
}
