// After a build: the app archive must hold only what Launchpad needs, never a capture (.nam) or dev files.
//   node scripts/check-dist.mjs     (checks every app.asar under dist/)
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
const found = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (n === "app.asar") found.push(p); else if (statSync(p).isDirectory() && !n.endsWith(".asar.unpacked")) walk(p); } })("dist");
let bad = 0;
for (const a of found) {
  const files = execFileSync("npx", ["--yes", "@electron/asar", "list", a], { encoding: "utf8" }).split("\n").filter((f) => !f.startsWith("/node_modules"));
  const wrong = files.filter((f) => /\.nam$|\/_dev\b|\.gp5backup$|\.a2r$|GP-5_USB_/.test(f));
  const missing = ["/main.js", "/services.js", "/preload.js", "/src/index.html", "/src/app.js"].filter((f) => !files.includes(f));
  if (wrong.length || missing.length) { bad++; console.error(`${a}:\n  must not contain: ${wrong.join(", ") || "-"}\n  missing: ${missing.join(", ") || "-"}`); }
  else console.log(`ok  ${a}`);
}
if (!found.length) { console.error("no app.asar under dist/: build first"); process.exit(1); }
// the bundled firmware list is what users see in Flash: no "dev" versions in a release (LAUNCHPAD_ALLOW_DEV=1 for a test build)
const dev = JSON.parse(readFileSync("src/firmware/manifest.json", "utf8")).filter((m) => /^dev\b/i.test(m.version));
if (dev.length && process.env.LAUNCHPAD_ALLOW_DEV !== "1") {
  bad++; console.error(`src/firmware/manifest.json: dev builds would show in Flash: ${dev.map((m) => `${m.title} (${m.version})`).join(", ")}\n  give them a release version, or LAUNCHPAD_ALLOW_DEV=1 for a test build`);
}
process.exit(bad ? 1 : 0);
