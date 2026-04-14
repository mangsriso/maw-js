import type { InvokeContext, InvokeResult } from "../../../plugin/types";

export const command = {
  name: "park",
  description: "Park (pause) an agent or list parked agents.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const { cmdPark, cmdParkLs } = await import("./impl");

  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => logs.push(a.map(String).join(" "));
  console.error = (...a: any[]) => logs.push(a.map(String).join(" "));

  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];

    if (args[0] === "ls" || args[0] === "list") {
      await cmdParkLs();
    } else {
      await cmdPark(...args);
    }
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
