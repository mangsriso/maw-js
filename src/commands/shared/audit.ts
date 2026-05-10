import { readAudit } from "../../sdk";
import { parseFlags } from "../../cli/parse-args";

type AuditRow = {
  ts: string;
  kind?: "anomaly";
  event?: string;
  cmd?: string;
  args?: string[];
  result?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export async function cmdAudit(args: string[] = []) {
  const flags = parseFlags(args, { "--anomalies": Boolean, "--event": String, "--since": String }, 0);

  const hasFilters = flags["--anomalies"] || flags["--event"] || flags["--since"];
  const rawLines = hasFilters ? readAudit(10000) : readAudit(20);

  let entries: AuditRow[] = [];
  for (const line of rawLines) {
    try { entries.push(JSON.parse(line) as AuditRow); } catch { /* skip malformed */ }
  }

  if (flags["--anomalies"]) entries = entries.filter(e => e.kind === "anomaly");
  if (flags["--event"]) entries = entries.filter(e => e.event === flags["--event"]);
  if (flags["--since"]) {
    const since = new Date(flags["--since"]!).getTime();
    if (!isNaN(since)) entries = entries.filter(e => new Date(e.ts).getTime() >= since);
  }

  if (!entries.length) {
    console.log("\x1b[90mNo audit entries yet.\x1b[0m");
    return;
  }

  const label = flags["--anomalies"] ? "Anomaly Trail" : "Audit Trail";
  console.log(`\x1b[36m${label}\x1b[0m (last ${entries.length})\n`);

  for (const entry of entries) {
    const date = new Date(entry.ts);
    const time = date.toLocaleString("en-GB", {
      month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });

    if (entry.kind === "anomaly") {
      const inputStr = JSON.stringify(entry.input ?? {});
      console.log(`  \x1b[90m${time}\x1b[0m  \x1b[33m⚠\x1b[0m \x1b[35m${entry.event}\x1b[0m  input=${inputStr}`);
    } else {
      const cmdArgs = entry.args?.length ? ` ${entry.args.join(" ")}` : "";
      const result = entry.result ? ` \x1b[90m→ ${entry.result}\x1b[0m` : "";
      console.log(`  \x1b[90m${time}\x1b[0m  \x1b[33m${entry.cmd}\x1b[0m${cmdArgs}${result}`);
    }
  }
  console.log();
}
