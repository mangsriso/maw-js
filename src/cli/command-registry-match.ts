/**
 * Command registration + matching + listing.
 *
 * Internal module — re-exported by ./command-registry.ts barrel.
 * Split from command-registry.ts as part of the ≤200 LOC seam work.
 */

import { commands, type CommandDescriptor } from "./command-registry-types";

/** Register a command from a descriptor + file path */
export function registerCommand(desc: CommandDescriptor, path: string, scope: "builtin" | "user") {
  const names = Array.isArray(desc.name) ? desc.name : [desc.name];
  for (const n of names) {
    const key = n.toLowerCase().trim();
    if (commands.has(key)) {
      console.log(`[commands] overriding "${key}" (was: ${commands.get(key)!.desc.scope}, now: ${scope})`);
    }
    commands.set(key, { desc: { ...desc, scope, path }, path });
  }
}

/** Match args against registered commands. Longest prefix wins. */
export function matchCommand(args: string[]): { desc: CommandDescriptor; remaining: string[]; key: string } | null {
  let best: { desc: CommandDescriptor; remaining: string[]; key: string; len: number } | null = null;

  for (const [key, entry] of commands) {
    const parts = key.split(/\s+/);
    // Check if args start with this command's parts
    let match = true;
    for (let i = 0; i < parts.length; i++) {
      if (!args[i] || args[i].toLowerCase() !== parts[i]) { match = false; break; }
    }
    if (match && parts.length > (best?.len ?? 0)) {
      best = { desc: entry.desc, remaining: args.slice(parts.length), key, len: parts.length };
    }
  }

  return best;
}

/** List all registered commands (for --help and completions) */
export function listCommands(): CommandDescriptor[] {
  const seen = new Set<string>();
  const result: CommandDescriptor[] = [];
  for (const [, entry] of commands) {
    const key = entry.path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry.desc);
  }
  return result;
}
