/**
 * Legacy-warning behavior (#343b — flips #341b).
 *
 * The "N legacy plugins loaded without artifact hash" warning now counts
 * ALL legacy plugins, including dev-mode symlinks. The previous exclusion
 * (introduced in #341b) under-reported the real legacy footprint on mixed
 * dev machines and made it too easy to forget unbuilt symlinked installs.
 *
 * Visibility is controlled by the unified verbosity module
 * (src/cli/verbosity.ts, task #2): warn() emits to stderr with a "⚠ "
 * prefix unless isQuiet() is true (--quiet, --silent, MAW_QUIET=1,
 * MAW_SILENT=1).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync, mkdirSync, mkdtempSync, rmSync,
  symlinkSync, writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { discoverPackages, __resetDiscoverStateForTests, resetDiscoverCache } from "../../src/plugin/registry";
import { setVerbosityFlags } from "../../src/cli/verbosity";

const created: string[] = [];
let origPluginsDir: string | undefined;
let origQuiet: string | undefined;
let origSilent: string | undefined;

function tmpDir(prefix = "maw-legacy-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}
function pluginsDir(): string { return process.env.MAW_PLUGINS_DIR!; }

beforeEach(() => {
  origPluginsDir = process.env.MAW_PLUGINS_DIR;
  origQuiet = process.env.MAW_QUIET;
  origSilent = process.env.MAW_SILENT;
  delete process.env.MAW_QUIET;    // ensure loud baseline per test
  delete process.env.MAW_SILENT;
  setVerbosityFlags({});            // clear any leaked --quiet/--silent state
  process.env.MAW_PLUGINS_DIR = join(tmpDir("maw-home-"), "plugins");
  mkdirSync(pluginsDir(), { recursive: true });
  __resetDiscoverStateForTests();
  resetDiscoverCache();  // alpha.67 memoization — clear between tests
});

afterEach(() => {
  if (origPluginsDir !== undefined) process.env.MAW_PLUGINS_DIR = origPluginsDir;
  else delete process.env.MAW_PLUGINS_DIR;
  if (origQuiet !== undefined) process.env.MAW_QUIET = origQuiet;
  else delete process.env.MAW_QUIET;
  if (origSilent !== undefined) process.env.MAW_SILENT = origSilent;
  else delete process.env.MAW_SILENT;
  setVerbosityFlags({});
  for (const d of created.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

/** Legacy manifest = no artifact field. Ships as an entry-only plugin. */
function legacyManifest(name: string): string {
  return JSON.stringify({
    name, version: "1.0.0", sdk: "*",
    target: "js", capabilities: [],
    entry: "./index.js",
  });
}

/** Plant a legacy plugin directly in the plugins dir (non-symlink). */
function plantLegacyDir(name: string): void {
  const dest = join(pluginsDir(), name);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "plugin.json"), legacyManifest(name));
  writeFileSync(join(dest, "index.js"), "export default () => ({ ok: true });\n");
}

/** Plant a legacy plugin as a symlink into the plugins dir. */
function plantLegacySymlink(name: string): void {
  const sourceDir = tmpDir(`maw-legacy-src-${name}-`);
  writeFileSync(join(sourceDir, "plugin.json"), legacyManifest(name));
  writeFileSync(join(sourceDir, "index.js"), "export default () => ({ ok: true });\n");
  symlinkSync(sourceDir, join(pluginsDir(), name), "dir");
}

/**
 * Capture stderr output while running fn. Task #2's verbosity module writes
 * via process.stderr.write — the prior console.warn capture no longer sees it.
 */
async function captureStderr(fn: () => void | Promise<void>): Promise<string> {
  const orig = process.stderr.write.bind(process.stderr);
  let captured = "";
  (process.stderr as any).write = (chunk: any) => {
    captured += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  };
  try { await fn(); }
  finally { (process.stderr as any).write = orig; }
  return captured;
}

describe("discoverPackages — legacy warning (default loud, #343b)", () => {
  test("all symlinks → warning IS emitted and counts them", async () => {
    plantLegacySymlink("dev-a");
    plantLegacySymlink("dev-b");
    plantLegacySymlink("dev-c");
    const err = await captureStderr(() => {
      const plugins = discoverPackages();
      expect(plugins.map(p => p.manifest.name).sort()).toEqual(["dev-a", "dev-b", "dev-c"]);
    });
    expect(err).toContain("3 legacy plugins loaded without artifact hash");
  });

  test("mix → warning counts ALL legacy plugins (symlinks + real installs)", async () => {
    plantLegacySymlink("dev-a");
    plantLegacySymlink("dev-b");
    plantLegacyDir("real-legacy-1");
    plantLegacyDir("real-legacy-2");
    const err = await captureStderr(() => {
      const plugins = discoverPackages();
      expect(plugins.map(p => p.manifest.name).sort())
        .toEqual(["dev-a", "dev-b", "real-legacy-1", "real-legacy-2"]);
    });
    // #343b: full count (4), not 2 as in #341b.
    expect(err).toContain("4 legacy plugins loaded without artifact hash");
  });

  test("MAW_QUIET=1 → legacy warning is suppressed", async () => {
    plantLegacyDir("real-legacy-1");
    plantLegacyDir("real-legacy-2");
    plantLegacySymlink("dev-a");
    process.env.MAW_QUIET = "1";
    const err = await captureStderr(() => {
      const plugins = discoverPackages();
      expect(plugins.length).toBe(3);
    });
    expect(err).not.toContain("legacy plugin");
  });

  test("setVerbosityFlags({ quiet: true }) → legacy warning is suppressed", async () => {
    plantLegacyDir("real-legacy-1");
    setVerbosityFlags({ quiet: true });
    const err = await captureStderr(() => {
      const plugins = discoverPackages();
      expect(plugins.length).toBe(1);
    });
    expect(err).not.toContain("legacy plugin");
  });
});
