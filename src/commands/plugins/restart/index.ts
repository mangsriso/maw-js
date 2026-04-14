import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdRestart } from "./impl";

export const command = {
  name: "restart",
  description: "Restart the maw server with optional update.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const noUpdate = args.includes("--no-update");
    const refIdx = args.indexOf("--ref");
    const ref = refIdx >= 0 ? args[refIdx + 1] : undefined;
    await cmdRestart({ noUpdate, ref });
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
