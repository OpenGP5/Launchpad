// Try the update check against a GitHub repository:  npx electron scripts/check-update.cjs [owner/repo] [tagPrefix]
const { app } = require("electron");
app.whenReady().then(async () => {
  const [repo, tagPrefix] = process.argv.slice(2).filter((a) => !a.endsWith(".cjs") && !a.startsWith("-") && a !== ".");
  console.log(JSON.stringify(await require("../services.js").checkUpdate(repo ? { repo, tagPrefix: tagPrefix ?? "v" } : undefined), null, 1));
  app.quit();
});
