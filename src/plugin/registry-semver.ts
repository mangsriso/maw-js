/**
 * Minimal semver helpers for plugin gate checks.
 *
 * Supports the range shapes validated by the manifest parser:
 *   *, N.N.N, ^N.N.N, ~N.N.N, >=N.N.N, <=N.N.N, >N.N.N, <N.N.N
 * We intentionally DON'T implement full npm-style range grammar — the parser
 * rejects those upstream. Pre-release/build metadata is stripped before
 * comparison (Phase A: release-train only).
 */

const CORE_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?(?:\+[\w.]+)?$/;

function parseCore(v: string): [number, number, number] | null {
  const m = CORE_RE.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

export function satisfies(version: string, range: string): boolean {
  const v = parseCore(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "*") return true;

  // Operator-prefixed (^, ~, >=, <=, >, <)
  const opMatch = /^(\^|~|>=|<=|>|<)(.+)$/.exec(r);
  const op = opMatch?.[1] ?? null;
  const rest = opMatch ? opMatch[2]! : r;
  const target = parseCore(rest);
  if (!target) return false;

  switch (op) {
    case "^": {
      // Same major. For 0.x: same minor. For 0.0.x: exact.
      if (cmp(v, target) < 0) return false;
      if (target[0] > 0) return v[0] === target[0];
      if (target[1] > 0) return v[0] === 0 && v[1] === target[1];
      return v[0] === 0 && v[1] === 0 && v[2] === target[2];
    }
    case "~": {
      // Same major.minor (or same major if no minor specified — we always have minor).
      if (cmp(v, target) < 0) return false;
      return v[0] === target[0] && v[1] === target[1];
    }
    case ">=": return cmp(v, target) >= 0;
    case "<=": return cmp(v, target) <= 0;
    case ">":  return cmp(v, target) > 0;
    case "<":  return cmp(v, target) < 0;
    default:   return cmp(v, target) === 0; // bare "1.2.3" → exact
  }
}

/**
 * Format the plan's canonical SDK-mismatch error.
 * Used by both the installer (pre-install) and the loader (at startup).
 */
export function formatSdkMismatchError(
  name: string,
  manifestSdk: string,
  runtimeVersion: string,
): string {
  return [
    `\x1b[31m✗\x1b[0m plugin '${name}' requires maw SDK ${manifestSdk}`,
    `  your maw: ${runtimeVersion}  (SDK ${runtimeVersion})`,
    ``,
    `  fix:`,
    `    • maw update                                    (upgrade maw)`,
    `    • maw plugin install ${name}@<old-version>      (older compat release)`,
    `    • (manual) edit plugin.json "sdk" to accept this version and rebuild`,
  ].join("\n");
}
