/**
 * maw plugin create — scaffold a new WASM command plugin from a template.
 *
 * Usage:
 *   maw plugin create --rust <name> [--here]
 *   maw plugin create --as  <name> [--here]
 *
 * --here  : scaffold in cwd/<name> instead of ~/.oracle/plugins/<name>
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

// Resolved at module load time — maw-js repo root
const MAW_DIR = resolve(import.meta.dir, "../..");
const SDK_RUST_ABS = join(MAW_DIR, "src/wasm/maw-plugin-sdk");
const TEMPLATE_RUST = join(MAW_DIR, "src/wasm/examples/hello-rust");
const TEMPLATE_AS = join(MAW_DIR, "src/wasm/examples/hello-as");

// ─── Validation ─────────────────────────────────────────────────────────────

export function validatePluginName(name: string): string | null {
  if (!name) return "name is required";
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return `"${name}" is invalid — use lowercase letters, digits, - or _ (must start with a letter)`;
  }
  return null;
}

// ─── Tree copy (skips build artifacts) ──────────────────────────────────────

const SKIP = new Set(["target", ".git", "node_modules"]);

export function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (SKIP.has(entry)) continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) {
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Build plugin.json content for a scaffolded plugin.
 * `name` field is slugified (underscores → hyphens) to match /^[a-z0-9-]+$/.
 * Returns a JSON string ready to write to disk.
 */
export function buildManifestJson(name: string, lang: "rust" | "as"): string {
  const slug = name.replace(/_/g, "-");
  const wasmPath =
    lang === "rust"
      ? `./target/wasm32-unknown-unknown/release/${name.replace(/-/g, "_")}.wasm`
      : "./build/release.wasm";
  const type = lang === "rust" ? "Rust" : "AssemblyScript";
  const manifest = {
    name: slug,
    version: "0.1.0",
    wasm: wasmPath,
    sdk: "^1.0.0",
    description: `${type} plugin: ${name}`,
    author: "",
    cli: { command: slug, help: `Invoke ${name}` },
    api: { path: `/api/plugins/${slug}`, methods: ["GET", "POST"] },
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

// ─── Rust scaffold ───────────────────────────────────────────────────────────

export function scaffoldRust(name: string, dest: string, templateDir = TEMPLATE_RUST, sdkPath = SDK_RUST_ABS): void {
  if (!existsSync(templateDir)) {
    throw new Error(`Rust template not found at ${templateDir}`);
  }

  copyTree(templateDir, dest);

  // Rewrite Cargo.toml: fix crate name and replace relative SDK path with absolute
  const cargoPath = join(dest, "Cargo.toml");
  let cargo = readFileSync(cargoPath, "utf8");
  // Replace any existing package name
  cargo = cargo.replace(/^name = ".*?"$/m, `name = "${name}"`);
  // Replace relative SDK path with absolute
  cargo = cargo.replace(
    /maw-plugin-sdk = \{ path = "[^"]*" \}/,
    `maw-plugin-sdk = { path = "${sdkPath}" }`,
  );
  writeFileSync(cargoPath, cargo);

  // Write README
  const crateName = name.replace(/-/g, "_");
  writeFileSync(
    join(dest, "README.md"),
    `# ${name}

A maw WASM command plugin (Rust).

## Build

\`\`\`bash
cd "${dest}"
cargo build --release --target wasm32-unknown-unknown
\`\`\`

Output: \`target/wasm32-unknown-unknown/release/${crateName}.wasm\`

## Install

\`\`\`bash
maw plugin install "${dest}"
\`\`\`

## SDK docs

See the SDK at \`${sdkPath}\` for available host functions:
\`maw::print\`, \`maw::identity\`, \`maw::federation\`, \`maw::send\`, \`maw::fetch\`.
`,
  );

  // Emit plugin.json manifest
  writeFileSync(join(dest, "plugin.json"), buildManifestJson(name, "rust"));
}

// ─── AssemblyScript scaffold ─────────────────────────────────────────────────

export function scaffoldAs(name: string, dest: string, templateDir = TEMPLATE_AS): void {
  if (!existsSync(templateDir)) {
    throw new Error(
      `AssemblyScript template not found at ${templateDir}\n` +
      `  The AS SDK is still being built — try again after the next maw update,\n` +
      `  or check: https://github.com/Soul-Brews-Studio/maw-js`,
    );
  }

  copyTree(templateDir, dest);

  // Rewrite package.json name
  const pkgPath = join(dest, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.name = name;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  // Write README
  writeFileSync(
    join(dest, "README.md"),
    `# ${name}

A maw WASM command plugin (AssemblyScript).

## Build

\`\`\`bash
cd "${dest}"
npm install
npm run build
\`\`\`

Output: \`build/${name}.wasm\`

## Install

\`\`\`bash
maw plugin install "${dest}"
\`\`\`
`,
  );

  // Emit plugin.json manifest
  writeFileSync(join(dest, "plugin.json"), buildManifestJson(name, "as"));
}

// ─── Top-level command ───────────────────────────────────────────────────────

export async function cmdPluginCreate(
  name: string | undefined,
  flags: {
    "--rust"?: boolean;
    "--as"?: boolean;
    "--here"?: boolean;
    /** Internal override for tests — bypasses homedir() resolution */
    "--dest"?: string;
  },
): Promise<void> {
  const isRust = !!flags["--rust"];
  const isAs = !!flags["--as"];

  // Validate flags
  if (!isRust && !isAs) {
    console.error("usage: maw plugin create [--rust | --as] <name> [--here]");
    console.error("  Specify either --rust or --as");
    process.exit(1);
  }
  if (isRust && isAs) {
    console.error("  Specify --rust or --as, not both");
    process.exit(1);
  }

  // Validate name
  if (!name) {
    console.error("usage: maw plugin create [--rust | --as] <name> [--here]");
    process.exit(1);
  }
  const nameErr = validatePluginName(name);
  if (nameErr) {
    console.error(`\x1b[31m✗\x1b[0m Invalid plugin name: ${nameErr}`);
    process.exit(1);
  }

  // Resolve destination
  const dest = flags["--dest"]
    ?? (flags["--here"]
      ? join(process.cwd(), name)
      : join(homedir(), ".oracle", "plugins", name));

  if (existsSync(dest)) {
    console.error(`\x1b[31m✗\x1b[0m Destination already exists: ${dest}`);
    process.exit(1);
  }

  const type = isRust ? "Rust" : "AssemblyScript";
  console.log(`\x1b[36m⚡\x1b[0m Creating ${type} plugin \x1b[1m${name}\x1b[0m`);
  console.log(`  → ${dest}`);

  try {
    if (isRust) {
      scaffoldRust(name, dest);
    } else {
      scaffoldAs(name, dest);
    }
  } catch (err: any) {
    console.error(`\x1b[31m✗\x1b[0m ${err.message}`);
    process.exit(1);
  }

  console.log(`\n\x1b[32m✓\x1b[0m Plugin scaffolded: \x1b[1m${name}\x1b[0m`);
  console.log(`\n\x1b[33mNext steps:\x1b[0m`);
  if (isRust) {
    console.log(`  1. cd "${dest}"`);
    console.log(`  2. Edit src/lib.rs — implement your command logic`);
    console.log(`  3. cargo build --release --target wasm32-unknown-unknown`);
    console.log(`  4. maw plugin install "${dest}"`);
  } else {
    console.log(`  1. cd "${dest}"`);
    console.log(`  2. Edit assembly/index.ts — implement your command logic`);
    console.log(`  3. npm install && npm run build`);
    console.log(`  4. maw plugin install "${dest}"`);
  }
}
