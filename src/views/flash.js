// Flash: put any GP-5 firmware image on the pedal: a release that ships with Launchpad, an OpenGP5 firmware
// someone built, or Valeton's own. The image is checked first (gp5flash.js inspect: container, CRCs, boot
// vectors), then written section by section through the factory loader, exactly as the web flasher does.
import * as F from "../lib/gp5flash.js";
import { changeFirmware } from "../lib/change.js";
import { imageKind, currentKind } from "../lib/storage.js";
import { backupNow } from "./backups.js";
import { entries as catalogEntries, check as catalogCheck, caution } from "../lib/catalog.js";

const ui = { manifest: null, chosen: null, error: null, agree: false, log: [], progress: null, result: null, running: false,
            cat: null, catLoading: false, getting: null };      // cat: { index, fresh, error } from the firmware catalog

async function loadManifest(ctx) {
  try { ui.manifest = JSON.parse(new TextDecoder().decode(await ctx.appFile("firmware/manifest.json"))); }
  catch { ui.manifest = []; }
  ctx.render();
}

async function loadCatalog(ctx) {
  ui.catLoading = true;
  try { ui.cat = await ctx.catalog(); } catch (e) { ui.cat = { index: null, error: e.message }; }
  ui.catLoading = false; ctx.render();
}

// the catalog's listings that aren't simply what ships with Launchpad (same id and version)
function catalogList() {
  const bundled = new Map((ui.manifest || []).map((m) => [m.id, (m.version.match(/\d+\.\d+\.\d+/) || [""])[0]]));
  return catalogEntries(ui.cat?.index).filter((e) => bundled.get(e.id) !== e.latest.version);
}

function choose(ctx, title, bytes, source, description = "", extra = {}) {
  ui.result = null; ui.log = []; ui.progress = null;
  try { const info = F.inspect(bytes); ui.chosen = { title, bytes, info, source, description, ...extra }; ui.error = null; }
  catch (e) { ui.chosen = null; ui.error = `${title}: ${e.message}`; }
  ctx.render();
}

function catalogHtml(ctx) {
  const { esc, icon } = ctx;
  if (!ui.cat) return `<p class="faint" style="font-size:13px">${ui.catLoading ? "Loading the catalog…" : ""}</p>`;
  if (!ui.cat.index) return `<div class="note">${icon("info-circle", 16)}<span>The catalog couldn't be loaded${ui.cat.error ? ` (${esc(ui.cat.error)})` : ""}. <button class="link" data-act="catretry">Try again</button></span></div>`;
  const list = catalogList();
  const stale = ui.cat.fresh ? "" : `<p class="faint" style="font-size:12.5px;margin-bottom:6px">Offline: the list from the last time Launchpad could reach OpenGP5's site.</p>`;
  if (!list.length) return stale + `<p class="faint" style="font-size:13px">Nothing more yet. Made a firmware? List it: OpenGP5's catalog/README.md.</p>`;
  return stale + `<div class="list">${list.map((e) => `
      <button class="item tall pick ${ui.chosen?.source === "catalog:" + e.id ? "sel" : ""}" data-cat="${esc(e.id)}" ${ui.getting ? "disabled" : ""}>
        <span class="pill world" style="width:30px;height:30px;justify-content:center;padding:0;border-radius:9px">${icon(e.official ? "sparkles" : "puzzle", 16)}</span>
        <span class="main"><span class="name">${esc(e.name)} <span class="faint" style="font-weight:500">by ${esc(e.author)}</span></span>
          <span class="sub clamp2" title="${esc(e.description)}">${ui.getting === e.id ? "Downloading and checking…" : esc(e.description)}</span></span>
        <span class="stack" style="gap:4px;align-items:flex-end"><span class="pill mono">${esc(e.latest.version)}</span>
          <span class="pill ${e.official ? "" : "warn"}" style="font-size:11px">${e.official ? "OpenGP5" : "Not reviewed"}</span></span>
      </button>`).join("")}</div>`;
}

export default {
  id: "flash", title: "Flash firmware", icon: "bolt", world: "w-flash",
  render(ctx) {
    const { esc, icon, state } = ctx;
    if (!ui.manifest) { loadManifest(ctx); }
    if (!ui.cat && !ui.catLoading) loadCatalog(ctx);
    const lib = (ui.manifest || []).map((m) => `
      <button class="item tall pick ${ui.chosen?.source === m.file ? "sel" : ""} ${m.world}" data-file="${esc(m.file)}">
        <span class="pill world" style="width:30px;height:30px;justify-content:center;padding:0;border-radius:9px">${icon(m.file.includes("nam") ? "wave-sine" : m.file.includes("dream") ? "sparkles" : "bolt", 16)}</span>
        <span class="main"><span class="name">${esc(m.title)}</span><span class="sub clamp2" title="${esc(m.description)}">${esc(m.description)}</span></span>
        <span class="pill mono">${esc(m.version)}</span>
      </button>`).join("");
    const c = ui.chosen;
    const sections = c ? c.info.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${(l.bytes / 1024).toFixed(1)} KB</td><td>${l.stock ? "Valeton V1.0.6" : "custom"}</td></tr>`).join("") : "";
    const p = state.pedal;
    const where = !p ? "Connect the pedal to flash." : p.mode === F.MODE_LOADER ? "The pedal is in update mode: ready."
      : `The pedal restarts into update mode and back on its own.`;
    const canFlash = c && ui.agree && p && !ui.running && !state.busy;
    return ctx.banner("w-flash", "bolt", "Flash firmware", "",
        { chips: [p ? (p.mode === F.MODE_LOADER ? "pedal in update mode" : "pedal connected") : "no pedal connected"] }) + `
      <div class="cols w-flash" style="--n:2">
        <section class="card"><div class="card-head"><h2>${icon("list", 18)} Choose a firmware</h2></div>
          <div class="list">${lib}
            <button class="item tall pick w-stock ${ui.chosen?.source === "valeton" ? "sel" : ""}" data-act="valeton">
              <span class="pill world" style="width:30px;height:30px;justify-content:center;padding:0;border-radius:9px">${icon("adjustments-horizontal", 16)}</span>
              <span class="main"><span class="name">Valeton's firmware</span><span class="sub clamp2">The factory firmware, downloaded from valeton.net.</span></span>
              <span class="pill mono">V1.0.6</span></button></div>
          <h3 class="sub-head">${icon("download", 16)} More from the catalog</h3>
          ${catalogHtml(ctx)}
          <div class="drop" style="margin-top:12px" id="flashdrop">${icon("file-import", 24)}
            <div style="flex:1;min-width:0"><b style="color:var(--text)">Your own file</b><br><span style="font-size:13px">Drop a .bin file here.</span></div>
            <button class="btn small" data-act="open">Choose file</button></div>
          ${ui.error ? `<div class="note bad" style="margin-top:12px">${icon("alert-triangle", 16)}<span>${esc(ui.error)}</span></div>` : ""}
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon("bolt", 18)} ${c ? esc(c.title) : "Nothing chosen yet"}</h2></div>
          ${c?.description ? `<p class="muted" style="margin-bottom:12px">${esc(c.description)}</p>` : ""}
          ${c?.entry ? `<div class="note ${c.entry.official ? "" : "warn"}" style="margin-bottom:12px">${icon(c.entry.official ? "info-circle" : "alert-triangle", 16)}<span>${esc(caution(c.entry))}
              <button class="link" data-repo="${esc(c.entry.repo)}">Source and releases</button></span></div>` : ""}${c ? `<table class="plain"><thead><tr><th>Part</th><th>Size</th><th>Contents</th></tr></thead><tbody>${sections}</tbody></table>` :
                '<p class="muted">Choose a firmware.</p>'}
          <div class="stack" style="margin-top:14px">
            ${c && currentKind(ctx.state.pedal) === "stock" && imageKind(c.bytes).kind !== "stock" ? `<div class="note warn">${icon("alert-triangle", 16)}<span><b>Leaving Valeton's firmware?</b> Export your SnapTones and user IRs in Valeton Suite first: Launchpad can't back them up, and they may not survive. Launchpad backs up your 100 presets when you flash; global settings stay on the pedal.</span></div>` : ""}
            <label class="check"><input type="checkbox" id="agree" ${ui.agree ? "checked" : ""}><span>Keep the pedal connected until it's done. Custom firmware is at your own risk.</span></label>
            <p class="faint" style="font-size:12.5px">${esc(where)}</p>
            <div class="row"><button class="btn primary" data-act="flash" ${canFlash ? "" : "disabled"} aria-describedby="flash-why">${icon("bolt", 16)} Flash${c ? " " + esc(c.title) : ""}</button>
              ${canFlash || ui.running ? "" : `<span class="faint" id="flash-why" style="font-size:12.5px">${!c ? "Choose a firmware first." : !p ? "Connect the pedal first." : !ui.agree ? "Tick the box above first." : "Launchpad is busy with something else."}</span>`}</div>
            ${ui.progress ? `<div><p class="muted" style="font-size:13px;margin-bottom:6px">${esc(ui.progress.label)}</p><progress max="1" value="${ui.progress.f}"></progress></div>` : ""}
            ${ui.result ? `<div class="note ${ui.result.ok ? "good" : "bad"}">${icon(ui.result.ok ? "circle-check" : "alert-triangle", 16)}<span style="white-space:pre-wrap">${esc(ui.result.text)}</span></div>` : ""}
            ${ui.log.length ? `<div class="log">${esc(ui.log.join("\n"))}</div>` : ""}
          </div>
        </section>
      </div>
      <div class="note" style="margin-top:var(--gap)">${icon("info-circle", 16)}<span>Recovery: unplug, hold the foot switch and PARA, plug back in (the red “don't shut down” screen = update mode), flash again.</span></div>`;
  },
  mount(root, ctx) {
    root.querySelectorAll("[data-file]").forEach((b) => b.onclick = async () => {
      const m = ui.manifest.find((x) => x.file === b.dataset.file);
      try { choose(ctx, m.title, await ctx.appFile("firmware/" + m.file), m.file, m.description); }
      catch (e) { ui.error = `${m.title}: ${e.message}`; ctx.render(); }
    });
    root.querySelectorAll("[data-cat]").forEach((b) => b.onclick = async () => {
      const e = catalogList().find((x) => x.id === b.dataset.cat), r = e.latest;
      ui.getting = e.id; ui.error = null; ctx.render();
      try {
        const bytes = await ctx.catalogDownload(r.url, r.sha256);
        const errs = await catalogCheck(bytes, e, r);
        if (errs.length) throw new Error(`the download isn't what the catalog lists: ${errs.join("; ")}. Not flashed.`);
        choose(ctx, `${e.name} ${r.version}`, bytes, "catalog:" + e.id, e.description, { entry: e });
      } catch (x) { ui.error = `${e.name}: ${x.message}`; }
      finally { ui.getting = null; ctx.render(); }
    });
    root.querySelectorAll("[data-repo]").forEach((b) => b.onclick = () => window.launchpad?.openLink(b.dataset.repo));
    const retry = root.querySelector('[data-act="catretry"]');
    if (retry) retry.onclick = () => { ui.cat = null; loadCatalog(ctx); };
    root.querySelector('[data-act="valeton"]').onclick = async () => {
      const f = await ctx.stockImage();
      if (f) choose(ctx, "Valeton's firmware V1.0.6", f.bytes, "valeton", "The factory firmware, downloaded from valeton.net.");
    };
    root.querySelector('[data-act="open"]').onclick = async () => {
      const f = await ctx.openFile("Choose a GP-5 firmware image", [{ name: "GP-5 firmware", extensions: ["bin"] }]);
      if (f) choose(ctx, f.name, f.bytes, "file");
    };
    const drop = root.querySelector("#flashdrop");
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) choose(ctx, f.name, new Uint8Array(await f.arrayBuffer()), "file"); };
    root.querySelector("#agree").onchange = (e) => { ui.agree = e.target.checked; ctx.render(); };
    root.querySelector('[data-act="flash"]').onclick = async () => {
      const c = ui.chosen, target = imageKind(c.bytes);
      if (target.kind === currentKind(ctx.state.pedal) && !(await ctx.confirm(`Flash ${c.title}?`, "The pedal keeps what this firmware stores.", "Flash"))) return;
      ui.running = true; ui.log = []; ui.result = null; ui.progress = { label: "Starting", f: 0 }; ctx.render();
      const say = (t) => { ui.log.push(t); const l = document.querySelector(".log"); if (l) { l.textContent = ui.log.join("\n"); l.scrollTop = 1e9; } else ctx.render(); };
      let lastDraw = 0;
      try {
        const r = await changeFirmware(ctx, { sections: c.info.sections, target, backupNow: () => backupNow(ctx), say, progress: (name, done, total) => {
          ui.progress = { label: `Writing ${name}: ${done} of ${total}`, f: done / total };
          const now = Date.now(); if (now - lastDraw > 120 || done === total) { lastDraw = now; const pr = document.querySelector("progress"); if (pr) { pr.value = done / total; pr.previousElementSibling.textContent = ui.progress.label; } }
        } });
        if (!r) { ui.progress = null; ui.log = []; return; }
        const mode = r.mode;
        ui.result = { ok: true, text: mode ? `Done. The pedal is back, running ${mode === F.MODE_OPEN ? "the new firmware" : "Valeton's firmware"}.` : "Written. The pedal hasn't reappeared yet: give it a few seconds." };
        ui.progress = null;
      } catch (e) {
        ui.result = { ok: false, text: e.message };
      } finally { ui.running = false; ctx.render(); }
    };
  },
};
