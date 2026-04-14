import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdTeamShutdown, cmdTeamList } from "./impl";

export const command = {
  name: "team",
  description: "Manage agent teams — shutdown and list.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const sub = args[0]?.toLowerCase();

    if (sub === "shutdown" || sub === "down") {
      if (!args[1]) {
        logs.push("usage: maw team shutdown <name> [--force]");
        return { ok: false, error: "name required", output: logs.join("\n") };
      }
      await cmdTeamShutdown(args[1], { force: args.includes("--force") });
    } else if (sub === "list" || sub === "ls" || !sub) {
      await cmdTeamList();
    } else {
      logs.push(`unknown team subcommand: ${sub}`);
      logs.push("usage: maw team <shutdown|list>");
      return { ok: false, error: `unknown subcommand: ${sub}`, output: logs.join("\n") };
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
