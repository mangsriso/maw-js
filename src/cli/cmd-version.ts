import { execSync } from "child_process";

export function getVersionString(): string {
  const pkg = require("../../package.json");
  let hash = "";
  try { hash = execSync("git rev-parse --short HEAD", { cwd: import.meta.dir, stdio: "pipe" }).toString().trim(); } catch {}
  let buildDate = "";
  try {
    const raw = execSync("git log -1 --format=%ci", { cwd: import.meta.dir, stdio: "pipe" }).toString().trim();
    const d = new Date(raw);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    buildDate = `${raw.slice(0, 10)} ${days[d.getDay()]} ${raw.slice(11, 16)}`;
  } catch {}
  return `maw v${pkg.version}${hash ? ` (${hash})` : ""}${buildDate ? ` built ${buildDate}` : ""}`;
}
