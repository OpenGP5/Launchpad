// Backups: one file (.gp5backup) with everything Launchpad can read from a pedal running OpenGP5 firmware:
// the settings store (every firmware's settings and presets), the data area, the NAM bank and Dreamcatcher's
// presets (lib/backup.js). Restore picks what goes back: single tone slots, Dreamcatcher's presets, or the raw
// areas exactly as they were. Every part is checked (shape, size, checksum) before it can be picked.
import { MODE_OPEN, MODE_STOCK, storeSave, readStore, cmd } from "../lib/device.js";
import { makeBackup, parseBackup, serialize, restorable, KIND_OWNER } from "../lib/backup.js";
import { writeKeep, SLOT_BYTES } from "../lib/gp5nam.js";
import { IDS, encodeDreamcatcher, STORE, SECTOR, STORE_SIZE, parseStore, latest, fourcc } from "../lib/gp5store.js";
import { listFiles, writeFile, deleteFile, TOTAL_SECTORS } from "../lib/gp5files.js";
import { NAM_OWNER, toneName } from "../lib/namfiles.js";
import { ownerTitle, idName } from "../lib/owners.js";
import { currentKind } from "../lib/storage.js";
import { readPreset, writePreset, samePreset } from "../lib/stockpresets.js";

const KIND_TITLE = { stock: "Valeton firmware", nam: "NAM Loader", dreamcatcher: "Dreamcatcher", tuner: "Strobe tuner", opengp5: "OpenGP5 firmware" };
// does a backup made from firmware `kind` fit the pedal now? (unknown kinds: older backups, allowed)
const fits = (kind, state) => !!kind && kind === currentKind(state.pedal);

const ui = { progress: null, result: null, restore: null, picks: new Set(), usage: null, usageFor: null };

// What's on the pedal, per firmware: files (sectors) and settings records. Read inside the link lock.
async function readUsage(link) {
  const dir = await listFiles(link), store = await readStore(link), by = new Map();
  const get = (id) => { if (!by.has(id)) by.set(id, { id, files: [], sectors: 0, settings: 0 }); return by.get(id); };
  for (const f of dir.files) { const o = get(f.owner); o.files.push(f.name); o.sectors += f.sectors; }
  for (const [id, r] of latest(store)) get(id).settings = r.len;
  return { owners: [...by.values()].sort((a, b) => b.sectors - a.sectors || b.settings - a.settings), used: dir.used.size, total: TOTAL_SECTORS };
}
const two = (n) => String(n).padStart(2, "0");

function history() { try { return JSON.parse(localStorage.getItem("backups") || "[]"); } catch { return []; } }
function remember(entry) { try { localStorage.setItem("backups", JSON.stringify([entry, ...history()].slice(0, 12))); } catch { /* no storage */ } }

const le32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];


function storageCard(ctx) {
  const { esc, icon, state } = ctx, u = ui.usage;
  if (!(state.pedal?.mode === MODE_OPEN) || !u) return "";
  const cur = { nam: "AMPB", dreamcatcher: "DRMC", tuner: "TUNR" }[state.pedal.firmware?.kind];
  const pct = Math.round(u.used / u.total * 100);
  return `<section class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>${icon("archive", 18)} What's on the pedal</h2>
      <span class="faint mono">${u.used * 4} of ${u.total * 4} KB of files · ${pct}%</span></div>
    <div style="height:10px;border-radius:6px;background:var(--surface-3);overflow:hidden;margin-bottom:12px"><div style="height:100%;width:${pct}%;background:var(--backup-strong)"></div></div>
    ${u.owners.length ? `<div class="list">${u.owners.map((o) => `<div class="item tall"><span class="main"><span class="name">${esc(ownerTitle(o.id))}${idName(o.id) === cur ? ' <span class="pill">running</span>' : ""}</span>
        <span class="sub">${o.files.length ? `${o.files.length} file${o.files.length === 1 ? "" : "s"}, ${o.sectors * 4} KB` : "no files"}${o.settings ? ` · settings ${o.settings} bytes` : ""}</span></span>
        ${o.files.length && idName(o.id) !== cur ? `<button class="btn small ghost danger" data-free="${o.id}" title="Delete this firmware's files">${icon("trash", 15)} Files</button>` : ""}</div>`).join("")}</div>`
      : '<p class="muted">Nothing stored yet.</p>'}
    </section>`;
}

// Back up the pedal (also used before a firmware change): read, save, remember. true when saved.
export async function backupNow(ctx) {
  const { state } = ctx;
  ui.result = null; ui.progress = { label: "Starting", f: 0 }; ctx.render();
  let saved = null;
  try {
    const b = await ctx.withLink("Backing up", (link) => makeBackup(link, state.pedal, ctx.appVersion, (f, label) => {
      ui.progress = { label, f }; const pr = document.querySelector("progress"); if (pr) { pr.value = f; pr.previousElementSibling.textContent = label; } }));
    const date = new Date().toISOString().slice(0, 10);
    saved = await ctx.saveFile("Save the backup", `GP-5 backup ${date} ${b.pedal.title || ""}.gp5backup`.replace(/\s+\.gp5backup$/, ".gp5backup"),
      [{ name: "Launchpad backup", extensions: ["gp5backup"] }], serialize(b));
    if (saved) {
      const files = b.parts.find((x) => x.kind === "files")?.files || [];
      const tones = (b.parts.find((x) => x.kind === "nam-bank")?.slots.length ?? 0) + files.filter((f) => f.owner === "AMPB" && /^tone-/.test(f.name)).length;
      const other = files.filter((f) => !(f.owner === "AMPB" && /^tone-/.test(f.name))).length, dc = b.parts.find((x) => x.kind === "dreamcatcher-presets");
      const vp = b.parts.find((x) => x.kind === "valeton-presets");
      const what = vp ? `${vp.presets.length} Valeton presets` : [tones && `${tones} tone${tones === 1 ? "" : "s"}`, other && `${other} other file${other === 1 ? "" : "s"}`,
                    dc && `${dc.slots.filter((s) => s.values).length} Dreamcatcher presets`, "settings"].filter(Boolean).join(", ");
      remember({ file: saved.name, path: saved.path, created: b.created, what, firmware: b.pedal.firmware, title: b.pedal.title });
      ui.result = { ok: true, text: `Saved ${saved.name}.` };
    }
  } catch (e) { ui.result = { ok: false, text: e.message }; }
  ui.progress = null; ctx.render();
  return !!saved;
}

export default {
  id: "backups", title: "Backups", icon: "archive", world: "w-backup",
  render(ctx) {
    const { state, esc, icon } = ctx, p = state.pedal;
    const canTalk = ((p?.mode === MODE_OPEN && !!p.firmware) || (p?.mode === MODE_STOCK && !!state.stock?.list)) && !!state.link && !state.busy;
    const hist = history(), r = ui.restore, verdict = r ? restorable(r.backup, currentKind(state.pedal)) : null, items = verdict ? verdict.items : [];
    const head = ctx.banner("w-backup", "archive", "Backups", "",
      { actions: `<button class="btn primary" data-act="backup" ${canTalk ? "" : "disabled"}>${icon("download", 16)} Back up now</button>`,
        chips: hist.length ? [`last: ${new Date(hist[0].created).toLocaleDateString()}`] : ["no backups yet"] });
    return head + `<div class="cols stretch w-backup" style="--n:2">
      <section class="card"><div class="card-head"><h2>${icon("history", 18)} Backups from this computer</h2></div>
        ${p?.mode === MODE_STOCK ? `<div class="note warn" style="margin-bottom:10px">${icon("alert-triangle", 16)}<span>With Valeton's firmware, a backup holds its 100 presets. <b>SnapTones and user IRs aren't included:</b> export them in Valeton Suite before you install another firmware, or they may be lost. Global settings stay on the pedal.</span></div>` : ""}
        ${ui.progress ? `<div style="margin-bottom:10px"><p class="muted" style="font-size:12.5px;margin-bottom:6px">${esc(ui.progress.label)}</p><progress max="1" value="${ui.progress.f}"></progress></div>` : ""}
        ${ui.result ? `<div class="note ${ui.result.ok ? "good" : "bad"}" style="margin-bottom:10px">${icon(ui.result.ok ? "circle-check" : "alert-triangle", 16)}<span>${esc(ui.result.text)}</span></div>` : ""}
        ${hist.length ? `<div class="list">${hist.map((h, i) => `<div class="item tall"><span class="main"><span class="name">${esc(h.file)}</span>
            <span class="sub">${esc(new Date(h.created).toLocaleString())} · ${esc(h.what)}</span></span>
            ${h.firmware ? `<span class="pill ${fits(h.firmware, state) ? "world" : ""}" title="Made from ${esc(KIND_TITLE[h.firmware] || h.firmware)}">${esc(KIND_TITLE[h.firmware] || h.firmware)}</span>` : ""}
            ${h.path && window.launchpad ? `<button class="btn small" data-hist="${i}" ${fits(h.firmware, state) && canTalk ? "" : "disabled"}
              title="${fits(h.firmware, state) ? "Restore" : `Install ${esc(KIND_TITLE[h.firmware] || h.firmware)} to restore this`}">${icon("refresh", 15)} Restore</button>` : ""}</div>`).join("")}</div>`
          : '<p class="muted">None yet.</p>'}
      </section>
      <section class="card"><div class="card-head"><h2>${icon("refresh", 18)} Restore</h2>${r ? `<button class="btn small ghost icon-only" data-act="close" aria-label="Close this backup">${icon("x", 15)}</button>` : ""}</div>
        ${!r ? `<p class="muted">Pick a backup from the list, or open a backup file.</p>
            <div style="margin-top:12px"><button class="btn" data-act="open">${icon("file-import", 16)} Open a file</button></div>`
        : `<div class="stack">
            <div><b>${esc(r.name)}</b><span class="sub faint" style="display:block;font-size:12.5px">${esc(new Date(r.backup.created).toLocaleString())} · ${esc(r.backup.pedal?.title || "OpenGP5")}</span></div>
            ${!verdict.ok || !items.length ? `<div class="note warn">${icon("alert-triangle", 16)}<span>${esc(verdict.why)}</span></div>` : ""}
            ${r.problems.length ? `<div class="note bad">${icon("alert-triangle", 16)}<span>Damaged parts (can't be restored): ${esc(r.problems.join(", "))}</span></div>` : ""}
            ${items.length ? `<div class="list">${items.map((it) => `<label class="item check" style="cursor:${it.bad ? "default" : "pointer"}"><input type="checkbox" data-pick="${it.id}" ${ui.picks.has(it.id) ? "checked" : ""} ${it.bad ? "disabled" : ""}>
              <span class="main"><span class="name" style="font-weight:600;${it.bad ? "color:var(--text-3)" : ""}">${esc(it.label)}</span></span></label>`).join("")}</div>
            <div class="row" style="justify-content:flex-end">
              <button class="btn primary" data-act="restore" ${ui.picks.size && canTalk ? "" : "disabled"}>${icon("refresh", 16)} Restore ${ui.picks.size || ""} part${ui.picks.size === 1 ? "" : "s"}</button></div>` : ""}</div>`}
      </section></div>
      ${storageCard(ctx)}`;
  },
  mount(root, ctx) {
    const { state } = ctx;
    const key = state.pedal?.mode === MODE_OPEN && state.pedal.firmware ? state.pedalSerial : null;
    if (key !== null && ui.usageFor !== key && !state.busy) {        // read once per pedal
      ui.usageFor = key;
      ctx.withLink("Reading storage", async (link) => { ui.usage = await readUsage(link); }).catch(() => { ui.usageFor = null; });
    }
    root.querySelectorAll("[data-free]").forEach((b) => b.onclick = async () => {
      const id = +b.dataset.free, o = ui.usage.owners.find((x) => x.id === id);
      if (!(await ctx.confirm(`Delete ${ownerTitle(id)}'s files?`, `${o.files.length} file${o.files.length === 1 ? "" : "s"} (${o.sectors * 4} KB) are deleted from the pedal. Its settings stay. A backup keeps a copy if you made one.`, "Delete files", true))) return;
      try { await ctx.withLink("Deleting files", async (link) => { for (const n of o.files) await deleteFile(link, id, n); ui.usage = await readUsage(link); }); ctx.toast("Deleted"); }
      catch (e) { ui.result = { ok: false, text: e.message }; ctx.render(); }
    });
    root.querySelector('[data-act="backup"]').onclick = () => backupNow(ctx);
    const openBackup = async (f) => {
      try {
        const { backup, problems } = await parseBackup(f.bytes);
        ui.restore = { name: f.name, backup, problems };
        ui.picks = new Set(restorable(backup, currentKind(ctx.state.pedal)).items.filter((it) => !it.bad).map((it) => it.id));
      } catch (e) { ui.result = { ok: false, text: e.message }; }
      ctx.render();
    };
    root.querySelectorAll("[data-hist]").forEach((b) => b.onclick = async () => {
      const h = history()[+b.dataset.hist];
      try { await openBackup(await window.launchpad.readBackup(h.path)); }
      catch { ui.result = { ok: false, text: `Couldn't open ${h.file}: it was moved or deleted. Use "Open a file" to find it.` }; ctx.render(); }
    });
    root.querySelector('[data-act="open"]')?.addEventListener("click", async () => {
      const f = await ctx.openFile("Open a backup", [{ name: "Launchpad backup", extensions: ["gp5backup"] }]);
      if (!f) return;
      try {
        const { backup, problems } = await parseBackup(f.bytes);
        ui.restore = { name: f.name, backup, problems };
        ui.picks = new Set(restorable(backup, currentKind(ctx.state.pedal)).items.filter((it) => !it.bad).map((it) => it.id));
      } catch (e) { ui.result = { ok: false, text: e.message }; }
      ctx.render();
    });
    root.querySelector('[data-act="close"]')?.addEventListener("click", () => { ui.restore = null; ui.picks.clear(); ctx.render(); });
    root.querySelectorAll("[data-pick]").forEach((c) => c.onchange = () => { c.checked ? ui.picks.add(c.dataset.pick) : ui.picks.delete(c.dataset.pick); ctx.render(); });
    root.querySelector('[data-act="restore"]')?.addEventListener("click", async () => {
      const backup = ui.restore.backup;
      const items = restorable(backup, currentKind(state.pedal)).items.filter((it) => ui.picks.has(it.id) && !it.bad);
      if (!items.length) return;
      if (!(await ctx.confirm("Restore from this backup?", `${items.length} part${items.length === 1 ? "" : "s"} on the pedal will be replaced by the backup's copy.`, "Restore"))) return;
      ui.result = null; ui.progress = { label: "Restoring", f: 0 }; ctx.render();
      let restart = false;
      try {
        await ctx.withLink("Restoring", async (link) => {
          // checked again now, with the pedal locked: the firmware may have changed since the screen was drawn
          const fw = currentKind(state.pedal), now = restorable(backup, fw);
          if (!now.ok) throw new Error(now.why + " Nothing was written.");
          const allowed = new Set(now.items.map((it) => it.id)), owner = KIND_OWNER[fw] ?? fw;
          let same = 0;
          for (let k = 0; k < items.length; k++) {
            const it = items[k];
            if (!allowed.has(it.id) || it.owner !== owner) throw new Error(`"${it.label}" doesn't belong to ${state.pedal?.firmware?.title}. Stopped.`);
            ui.progress = { label: it.label, f: k / items.length }; const pr = document.querySelector("progress"); if (pr) { pr.value = ui.progress.f; pr.previousElementSibling.textContent = it.label; }
            if (it.kind === "valeton") {                // one flash sector per preset: skip the ones already as backed up
              const n = it.preset.n - 1, want = { ...it.preset.preset };
              if (samePreset(await readPreset(link, n), want)) { same++; continue; }
              await writePreset(link, n, want);
            } else if (it.kind === "file") await writeFile(link, fourcc(owner.startsWith("fw:") ? it.file.owner : owner), it.file.name, it.file.bytes);
            else if (it.kind === "records") {           // a 1.0 firmware's records: the platform tells it to read them again
              for (const r of it.part.records) { const w = await storeSave(link, r.id, r.bytes); if (!w.reloaded) restart = true; }
            }
            else if (it.kind === "nam-slot") {
              if (ctx.filesMode()) await writeFile(link, NAM_OWNER, toneName(it.slot.slot - 1), it.slot.bytes);   // old backup, new storage
              else await writeKeep(link, (it.slot.slot - 1) * SLOT_BYTES, it.slot.bytes);
            } else if (it.kind === "dream") {
              const p = it.part, r = await storeSave(link, IDS.dreamcatcher, encodeDreamcatcher({ last: p.last - 1, slots: p.slots.map((s) => s.values), names: p.slots.map((s) => s.name || "") }, ctx.state.dreamFormat || 1));
              if (!r.reloaded) restart = true;
            } else if (it.kind === "settings") {
              const r = await storeSave(link, fourcc(owner), it.part.bytes);
              if (!r.reloaded) restart = true;
            }
          }
          if (fw === "nam") await ctx.loadNam(link);
          if (fw === "dreamcatcher") await ctx.loadDream(link);
          if (fw === "stock") { await ctx.loadStock(link); return same; }
          ui.usage = await readUsage(link);
          return same;
        }).then((same) => { ui.same = same; });
        const wrote = items.length - (ui.same || 0);
        ui.result = { ok: true, text: currentKind(state.pedal) === "stock"
          ? `Restored ${items.length} preset${items.length === 1 ? "" : "s"} (${wrote} written, ${ui.same} unchanged).`
          : `Restored ${items.length} part${items.length === 1 ? "" : "s"}.${restart ? " Restart the pedal (unplug, plug back in) so the firmware loads its restored settings." : ""}` };
      } catch (e) { ui.result = { ok: false, text: e.message }; }
      ui.progress = null; ctx.render();
    });
  },
};
