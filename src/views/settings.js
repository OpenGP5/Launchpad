// Settings: theme, updates, help (recovery steps, diagnostics for a bug report), about.
import { RECOVERY } from "../lib/gp5flash.js";
const THEMES = [["system", "Match system"], ["light", "Light"], ["dark", "Dark"]];   // [setting, label]

const ui = { check: null };

// styles.css themes: "studio" (light), "stage" (dark). "system" follows the computer's light / dark setting, live.
const sysDark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
let following = false;
export function applyTheme(t) {
  const dark = t === "system" ? (sysDark ? sysDark.matches : true) : t !== "light";
  document.documentElement.dataset.theme = dark ? "stage" : "studio";
  window.launchpad?.theme?.(t);                     // the window's background while loading ("system": main.js asks the OS)
  if (t === "system" && sysDark && !following) { following = true; sysDark.addEventListener("change", () => { if (savedTheme() === "system") applyTheme("system"); }); }
}
export function savedTheme() { try { const t = localStorage.getItem("theme"); return t === "light" || t === "system" ? t : "dark"; } catch { return "dark"; } }

export default {
  id: "settings", title: "Settings", icon: "settings",
  render(ctx) {
    const { esc } = ctx, cur = savedTheme();
    let on = true; try { on = localStorage.getItem("updates") !== "off"; } catch { /* no storage */ }
    return ctx.banner("w-home", "settings", "Settings", "") + `
      <div class="cols stretch" style="--n:2">
        <section class="card"><div class="card-head"><h2>Theme</h2></div>
          <div class="row">${THEMES.map(([id, name]) => `<button class="btn ${id === cur ? "primary" : ""}" data-theme="${id}" aria-pressed="${id === cur}">${esc(name)}</button>`).join("")}</div>
        </section>
        <section class="card"><div class="card-head"><h2>Updates</h2><button class="btn small" data-act="check">Check now</button></div>
          <label class="check"><input type="checkbox" id="updates" ${on ? "checked" : ""}><span>Check for updates at start-up</span></label>
          ${ui.check ? `<p class="faint" style="margin-top:8px;font-size:13px">${esc(ui.check)}</p>` : ""}
        </section>
      </div>
      <section class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Help</h2></div>
        <div class="row">
          <button class="btn small" data-act="recovery">Pedal stuck? Recovery steps</button>
          <button class="btn small" data-act="site">OpenGP5 on GitHub</button>
          <button class="btn small" data-act="diag">Copy diagnostics</button>
        </div>
        <p class="faint" style="margin-top:10px;font-size:13px">Copies versions, pedal details and recent errors as text for a bug report. Nothing is sent.</p>
      </section>
      <section class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>About</h2><span class="faint mono">${esc(ctx.appVersion)}</span></div>
        <p class="faint" style="font-size:13px">Not affiliated with Valeton. Fonts: Atkinson Hyperlegible Next and Mono (SIL OFL). Icons: Tabler (MIT).${ctx.state.sim ? " Simulated pedal." : ""}</p>
      </section>`;
  },
  mount(root, ctx) {
    root.querySelector("#updates").onchange = (e) => { try { localStorage.setItem("updates", e.target.checked ? "on" : "off"); } catch { /* no storage */ } };
    root.querySelector('[data-act="check"]').onclick = async () => {
      ui.check = "Checking…"; ctx.render();
      const r = await ctx.checkUpdate();
      ui.check = r.error ? (r.error === "only in the desktop app" ? "Only in the desktop app." : `Couldn't check (${r.error}).`)
        : r.update ? `${r.latest} is available (button at the top).` : `Up to date (${r.current}).`;
      ctx.render();
    };
    root.querySelector('[data-act="recovery"]').onclick = () => ctx.choose("If the pedal is stuck", RECOVERY, [{ value: "ok", label: "OK", primary: true }]);
    root.querySelector('[data-act="site"]').onclick = () => {
      const url = "https://github.com/OpenGP5/OpenGP5";
      if (window.launchpad?.openLink) window.launchpad.openLink(url); else window.open(url, "_blank", "noopener");
    };
    root.querySelector('[data-act="diag"]').onclick = async () => {
      const { state } = ctx, p = state.pedal;
      const text = [`OpenGP5 Launchpad ${ctx.appVersion} on ${navigator.platform} (${navigator.userAgent.match(/Electron\/[\d.]+|Chrome\/[\d.]+/g)?.join(", ") || "browser"})`,
        `Pedal: ${p ? `${p.mode}${p.firmware ? `, ${p.firmware.title}${p.firmware.platform ? `, platform ${p.firmware.platform}` : ""}` : ""}, port ${p.name}` : "not connected"}`,
        p?.mode === "stock firmware" && state.stock?.version ? `Valeton firmware constant 0x${state.stock.version.toString(16)}` : null,
        `Theme ${savedTheme()}, window ${innerWidth}x${innerHeight}`,
        "Recent problems:", ...(ctx.problems.length ? ctx.problems : ["(none)"])].filter(Boolean).join("\n");
      try { if (window.launchpad?.copyText) await window.launchpad.copyText(text); else await navigator.clipboard.writeText(text); ctx.toast("Diagnostics copied"); }
      catch { await ctx.choose("Diagnostics", text, [{ value: "ok", label: "OK", primary: true }]); }
    };
    root.querySelectorAll("[data-theme]").forEach((b) => b.onclick = () => {
      try { localStorage.setItem("theme", b.dataset.theme); } catch { /* no storage */ }
      applyTheme(b.dataset.theme);
      ctx.render();
    });
  },
};
