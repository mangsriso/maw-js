import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdWire } from "../../shared/comm";

export const command = { name: "wire", description: "Send a raw wire message to an agent." };

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    if (!args[0] || args.length < 2) throw new Error("usage: maw wire <agent> <message>");
    await cmdWire(args[0], args.slice(1).join(" "));
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
