import { join } from "path";
import { readdirSync, readFileSync, statSync } from "fs";

/** Extract agent name from project dir name, e.g. "-home-nat-Code-...-neo-oracle" → "neo-oracle" */
export function agentFromDir(dirName: string): string {
  const orgPrefixes = [
    "laris-co-",
    "Soul-Brews-Studio-",
    "nazt-",
    "DustBoy-PM25-",
    "FloodBoy-CM-",
  ];
  for (const prefix of orgPrefixes) {
    const idx = dirName.indexOf(prefix);
    if (idx !== -1) return dirName.slice(idx + prefix.length);
  }
  const parts = dirName.split("-");
  return parts.slice(-2).join("-");
}

/** List all JSONL files under a project dir (max depth 2 for subagents/) */
export function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.endsWith(".jsonl")) {
        files.push(full);
      } else {
        try {
          if (statSync(full).isDirectory()) {
            for (const sub of readdirSync(full)) {
              if (sub.endsWith(".jsonl")) files.push(join(full, sub));
            }
          }
        } catch { /* expected: dir entry may not be accessible */ }
      }
    }
  } catch { /* expected: log dir may not exist */ }
  return files;
}

/** Count non-empty lines in a file without reading entire content. @internal */
export function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").filter((l) => l.length > 0).length;
  } catch {
    return 0;
  }
}
