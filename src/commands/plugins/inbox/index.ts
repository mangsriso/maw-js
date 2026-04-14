import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdInboxLs, cmdInboxRead, cmdInboxWrite } from "./impl";

export const command = {
  name: "inbox",
  description: "Read and write agent inbox messages.",
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
    if (sub === "read") await cmdInboxRead(args[1]);
    else if (sub === "write" && args[1]) await cmdInboxWrite(args.slice(1).join(" "));
    else await cmdInboxLs();
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
