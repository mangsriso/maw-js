import type { InvokeContext, InvokeResult } from "../../../plugin/types";

export const command = {
  name: "tab",
  description: "Manage tmux tabs.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const { cmdTab } = await import("./impl");

  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    await cmdTab(args);
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
