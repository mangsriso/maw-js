/**
 * Plugin manifest — loadManifestFromDir: read plugin.json from a directory.
 */

import type { LoadedPlugin } from "./types";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { parseManifest } from "./manifest-parse";

/**
 * Load a plugin package from a directory.
 * Returns null if no plugin.json is present.
 * Throws if plugin.json exists but fails validation.
 */
export function loadManifestFromDir(dir: string): LoadedPlugin | null {
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) return null;
  const jsonText = readFileSync(manifestPath, "utf8");
  const manifest = parseManifest(jsonText, dir);

  // Entry resolution precedence:
  //   1. manifest.entry (legacy source-tree plugins)
  //   2. manifest.artifact.path (v1 compiled plugins — maw plugin build output)
  //   3. manifest.wasm (WASM plugins)
  // A JS bundle compiled via `maw plugin build` has `target:"js"` + `artifact.path:"./index.js"`
  // but no `entry`. Without this precedence, such plugins fall through to `kind:"wasm"` and
  // the loader tries to read the artifact as a WASM module.
  const hasWasm = !!manifest.wasm;
  const hasEntry = !!manifest.entry;
  const hasArtifactJs = manifest.target !== "wasm" && !!manifest.artifact?.path;
  const effectiveEntry = manifest.entry ?? (hasArtifactJs ? manifest.artifact!.path : undefined);

  return {
    manifest,
    dir,
    wasmPath: hasWasm ? resolve(dir, manifest.wasm!) : "",
    ...(effectiveEntry ? { entryPath: resolve(dir, effectiveEntry) } : {}),
    kind: (hasEntry || hasArtifactJs) ? "ts" as const : "wasm" as const,
  };
}
