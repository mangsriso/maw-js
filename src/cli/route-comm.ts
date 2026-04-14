import { cmdSend } from "../commands/shared/comm";

export async function routeComm(cmd: string, args: string[]): Promise<boolean> {
  // hey stays core — it's the transport layer
  if (cmd === "hey" || cmd === "send" || cmd === "tell") {
    const force = args.includes("--force");
    const msgArgs = args.slice(2).filter(a => a !== "--force");
    if (!args[1] || !msgArgs.length) { console.error("usage: maw hey <agent> <message> [--force]"); process.exit(1); }
    await cmdSend(args[1], msgArgs.join(" "), force);
    return true;
  }
  return false;
}
