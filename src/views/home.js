// Home: what the pedal is running (a banner in its colour), shortcuts, and what's on it. With an OpenGP5 firmware
// the banner carries the facts and the two actions (Back up, Flash) and the firmware's own card follows at once; with
// no pedal or Valeton's firmware, tiles are the way in.
import { MODE_OPEN, MODE_STOCK, MODE_LOADER } from "../lib/device.js";
import { isBlank } from "../lib/stockpresets.js";

const WORLD = { nam: "w-nam", dreamcatcher: "w-dream", tuner: "w-mods", opengp5: "w-mods" };

// a shortcut tile: big = a number (mono) or a word
function tile(ctx, world, view, iconName, big, cap, isNum = false) {
  return `<button class="tile ${world}" data-go="${view}">${ctx.icon(iconName, 22)}
    <span class="big ${isNum ? "num" : ""}">${ctx.esc(String(big))}</span><span class="cap">${ctx.esc(cap)}</span></button>`;
}

function backupsCard(ctx, { button = true } = {}) {   // button: off where the banner has Back up
  let h = [];
  try { h = JSON.parse(localStorage.getItem("backups") || "[]"); } catch { /* no storage */ }
  return `<section class="card w-backup"><div class="card-head"><h2>${ctx.icon("archive", 18)} Backups</h2><button class="btn small ghost" data-go="backups">Open</button></div>
    ${h.length ? `<div class="list">${h.slice(0, 4).map((b) => `<div class="item tall"><span class="main"><span class="name">${ctx.esc(b.file)}</span>
      <span class="sub">${ctx.esc(new Date(b.created).toLocaleDateString())} · ${ctx.esc(b.what)}</span></span></div>`).join("")}</div>`
      : `<p class="muted">${button ? "None yet." : "None yet. <b>Back up</b> above saves what's on the pedal to a file."}</p>${button ? `
        <div style="margin-top:12px"><button class="btn primary" data-go="backups">${ctx.icon("download", 16)} Back up now</button></div>` : ""}`}</section>`;
}

function contents(ctx) {
  const { state, esc, icon } = ctx, fw = state.pedal?.firmware?.kind;
  if (fw === "nam" && state.nam) {
    const filled = state.nam.bank.map((s, i) => [s, i]).filter(([s]) => s), empty = state.nam.bank.length - filled.length;
    const rows = filled.map(([s, i]) => `<div class="item"><span class="n">${String(i + 1).padStart(2, "0")}</span>
      <span class="main"><span class="name">${esc(s.name)}</span></span>
      ${s.crc === state.nam.playing ? `<span class="pill world" style="padding:0 6px" title="Playing" aria-label="playing">${icon("player-play", 12)}</span>` : ""}</div>`).join("");
    return `<div class="cols stretch" style="--n:2"><section class="card w-nam"><div class="card-head"><h2>${icon("wave-sine", 18)} Captures</h2>
      <button class="btn small ghost" data-go="tones">Manage</button></div>
      ${filled.length ? `<div class="mini home-caps">${rows}</div>` : `<p class="muted" style="margin:0">None yet. Add captures on the Tones page.</p>`}
      ${filled.length && empty ? `<p class="faint" style="font-size:12.5px;margin:8px 0 0">${empty} empty slot${empty === 1 ? "" : "s"}</p>` : ""}</section>${backupsCard(ctx, { button: false })}</div>`;
  }
  if (fw === "dreamcatcher") {
    const dream = state.dream || { last: 0, slots: Array(8).fill(null) };   // nothing saved yet: 8 empty slots
    const keys = [1, 9, 10, 11, 19, 20, 16, 18, 29];      // as the Presets page's bars: grains and reverb included
    const rows = dream.slots.map((v, i) => `<div class="item"><span class="n">P${i + 1}</span><span class="main">${v
      ? `<span class="bars" style="height:20px;gap:2px">${keys.map((k) => `<i style="height:${Math.max(10, Math.round(v[k] / 2.55))}%"></i>`).join("")}</span>`
      : '<span class="name empty">empty</span>'}</span>${state.dream && dream.last === i ? '<span class="pill world">start</span>' : ""}</div>`).join("");
    return `<div class="cols stretch" style="--n:2"><section class="card w-dream"><div class="card-head"><h2>${icon("sparkles", 18)} Presets</h2>
      <button class="btn small ghost" data-go="presets">${ctx.state.dreamLive ? "Edit" : "Manage"}</button></div><div class="mini">${rows}</div></section>${backupsCard(ctx, { button: false })}</div>`;
  }
  if (state.pedal?.mode === MODE_STOCK) return `<div class="cols stretch" style="--n:2"><section class="card w-stock"><div class="card-head"><h2>${icon("info-circle", 18)} Before you flash</h2></div>
    <p class="muted">Installing another firmware erases Valeton's presets. Back them up first. SnapTones and IRs aren't backed up, so keep your original files.</p></section>${backupsCard(ctx)}</div>`;
  if (!state.pedal) return backupsCard(ctx);
  return backupsCard(ctx, { button: state.pedal.mode !== MODE_OPEN });   // OpenGP5 firmwares: Back up is in the banner
}

export default {
  id: "home", title: "Home", icon: "home", world: "w-home",
  render(ctx) {
    const { state, icon } = ctx, p = state.pedal, fw = p?.firmware?.kind;
    let world = "w-home", deco = "plug-connected", title, text, chips = [], tiles = [], actions = "";
    if (!p) {
      title = state.problem ? "Launchpad can't reach USB-MIDI" : "Plug in your GP-5";
      text = !state.problem ? "Connect it with USB."
        : state.problemLinux ? "Launchpad uses ALSA's MIDI sequencer (/dev/snd/seq). If it's missing, load it with sudo modprobe snd-seq, then connect again."
        : window.launchpad?.relaunch ? "The computer's MIDI system didn't start in time. Restarting Launchpad usually fixes it."
        : "Allow MIDI access, then connect again.";
      if (state.problem) actions = window.launchpad?.relaunch
        ? `<button class="btn primary" data-act="relaunch">${icon("restore", 16)} Restart Launchpad</button>`
        : `<button class="btn primary" data-act="connect">${icon("plug-connected", 16)} Connect</button>`;
      tiles = [tile(ctx, "w-flash", "flash", "bolt", "Flash", "any firmware, stock or custom"), tile(ctx, "w-backup", "backups", "archive", "Restore", "from a backup file"),
               tile(ctx, "w-mods", "mods", "puzzle", "Mods", "for Valeton's firmware")];
    } else if (p.mode === MODE_OPEN) {
      world = WORLD[fw] || "w-mods"; deco = fw === "nam" ? "wave-sine" : fw === "dreamcatcher" ? "sparkles" : "bolt";
      title = p.firmware ? p.firmware.title : "Reading your GP-5…";
      text = "";
      if (p.firmware?.platform) chips.push(`OpenGP5 ${p.firmware.platform}`);
      if (fw === "nam" && state.nam) {
        const i = state.nam.bank.findIndex((s) => s && s.crc === state.nam.playing);
        chips.push(i >= 0 ? `playing ${String(i + 1).padStart(2, "0")} · ${state.nam.bank[i].name}` : "playing the built-in capture");
        chips.push(`${state.nam.bank.filter(Boolean).length} of ${state.nam.bank.length} captures`);
        if (state.nam.layout?.irBank) chips.push(`${(state.nam.cabs || []).filter(Boolean).length} of 12 IRs`);
      }
      if (fw === "dreamcatcher") {
        if (state.dream) chips.push(`starts on P${state.dream.last + 1}`);
        chips.push(`${state.dream ? state.dream.slots.filter(Boolean).length : 0} of 8 presets saved`);
      }
      const keeps = { nam: "tones and settings", dreamcatcher: "presets and settings", tuner: "the reference pitch" }[fw] || "its settings";
      actions = `<button class="btn primary" data-go="backups" title="Back up ${keeps}">${icon("download", 16)} Back up</button>
        <button class="btn" data-go="flash">${icon("bolt", 16)} Flash another firmware</button>`;
    } else if (p.mode === MODE_STOCK) {
      world = "w-stock"; deco = "adjustments-horizontal"; title = "Valeton firmware";
      text = "";
      const st = state.stock, cur = st?.list?.find((x) => x.n === st.current);
      if (cur) chips.push(`on preset ${String(cur.n).padStart(2, "0")} ${cur.name}`);
      if (st?.list) chips.push(`${st.list.filter((x) => !isBlank(x.name)).length} of 100 presets in use`);
      tiles = [tile(ctx, "w-flash", "flash", "bolt", "Flash", "an OpenGP5 firmware"), tile(ctx, "w-mods", "mods", "puzzle", "Mods", "for Valeton's firmware"),
               tile(ctx, "w-stock", "presets", "adjustments-horizontal", "Presets", "browse, edit, back up")];
    } else if (p.mode === MODE_LOADER) {
      world = "w-flash"; deco = "bolt"; title = "Update mode";
      text = "Waiting for a firmware.";
      actions = `<button class="btn primary" data-go="flash">${icon("bolt", 16)} Flash a firmware</button>`;
    } else {
      world = "w-backup"; deco = "alert-triangle"; title = "The GP-5 isn't answering";
      text = "Unplug it, hold the foot switch and PARA while plugging it back in (red “don't shut down” screen = update mode), then flash a firmware.";
      actions = `<button class="btn primary" data-go="flash">${icon("bolt", 16)} Go to Flash</button>`;
    }
    return ctx.banner(world, deco, title, text, { actions, chips }) +
      (tiles.length ? `<div class="tiles">${tiles.join("")}</div>` : "") + contents(ctx);
  },
  mount(root, ctx) {
    root.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => ctx.go(b.dataset.go));
    root.querySelector('[data-act="connect"]')?.addEventListener("click", () => document.getElementById("connect").click());
    root.querySelector('[data-act="relaunch"]')?.addEventListener("click", () => window.launchpad.relaunch());
  },
};
