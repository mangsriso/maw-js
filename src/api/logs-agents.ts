import { Elysia } from "elysia";
import { homedir } from "os";
import { join } from "path";
import { readdirSync, statSync, existsSync } from "fs";
import { agentFromDir, findJsonlFiles, countLines } from "./logs-helpers";

const projectsDir = join(homedir(), ".claude", "projects");

// GET /api/logs/agents — list all agents with session file count + total lines
export const logsAgentsApi = new Elysia();

logsAgentsApi.get("/logs/agents", () => {
  if (!existsSync(projectsDir)) {
    return { agents: [], total: 0 };
  }

  const agentMap = new Map<string, { files: number; lines: number; lastModified: string | null }>();

  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return { agents: [], total: 0 };
  }

  for (const dir of dirs) {
    const dirPath = join(projectsDir, dir);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const agent = agentFromDir(dir);
    const jsonlFiles = findJsonlFiles(dirPath);

    if (jsonlFiles.length === 0) continue;

    const existing = agentMap.get(agent) || { files: 0, lines: 0, lastModified: null };

    let latestMtime: Date | null = null;
    for (const file of jsonlFiles) {
      existing.files++;
      existing.lines += countLines(file);
      try {
        const mtime = statSync(file).mtime;
        if (!latestMtime || mtime > latestMtime) latestMtime = mtime;
      } catch { /* expected: file may have been deleted */ }
    }

    if (latestMtime) {
      const mtimeStr = latestMtime.toISOString();
      if (!existing.lastModified || mtimeStr > existing.lastModified) {
        existing.lastModified = mtimeStr;
      }
    }

    agentMap.set(agent, existing);
  }

  const agents = Array.from(agentMap.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => {
      if (!a.lastModified) return 1;
      if (!b.lastModified) return -1;
      return b.lastModified.localeCompare(a.lastModified);
    });

  return { agents, total: agents.length };
});
