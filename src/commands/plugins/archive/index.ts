import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdArchive } from "./impl";

export const command = {
  name: "archive",
  description: "Archive an oracle's tmux session and data.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    if (!args[0]) throw new Error("usage: maw archive <oracle> [--dry-run]");
    await cmdArchive(args[0], { dryRun: args.includes("--dry-run") });
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
