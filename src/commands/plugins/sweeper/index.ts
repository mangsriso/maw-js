import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdSweep, getSweeperStats } from "./impl";

export const command = {
  name: ["sweep"],
  description: "Auto-cleanup idle ephemeral worktrees",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    if (ctx.source === "api") {
      // GET = stats, POST = run sweep
      if (ctx.args?.method === "POST" || ctx.args?.action === "run") {
        const result = await cmdSweep({ dryRun: false });
        return { ok: true, output: JSON.stringify(result) };
      }
      const stats = getSweeperStats();
      return { ok: true, output: JSON.stringify(stats) };
    }

    // CLI mode
    const args = Array.isArray(ctx.args) ? ctx.args : [];
    const dryRun = args.includes("--dry-run");

    const result = await cmdSweep({ dryRun });
    const lines = [
      `Scanned: ${result.scanned}, Cleaned: ${result.cleanedIdle} idle + ${result.cleanedMaxAge} max-age`,
      `Skipped: ${result.skippedStatic} static`,
      ...(result.errors.length > 0 ? [`Errors: ${result.errors.join(", ")}`] : []),
      ...result.details.map(d => `  ${d.name}: ${d.reason}`),
    ];
    return { ok: true, output: lines.join("\n") };
  } catch (e: any) {
    return { ok: false, error: e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
  }
}
