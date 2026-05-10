/**
 * Command Plugin Registry — shared types, constants, and registry state.
 *
 * Internal module — re-exported by ./command-registry.ts barrel.
 * Split from command-registry.ts as part of the ≤200 LOC seam work.
 */

import type { WasmBridge } from "./wasm-bridge";

/* ─── WASM Safety Constants ─── */
export const WASM_MEMORY_MAX_PAGES = 256;       // 16MB max (256 * 64KB)
export const WASM_COMMAND_TIMEOUT_MS = 5_000;   // 5s limit for commands

export interface CommandDescriptor {
  name: string | string[];
  description: string;
  usage?: string;
  flags?: Record<string, any>;
  /** Resolved at registration */
  patterns?: string[][];
  path?: string;
  scope?: "builtin" | "user";
}

/**
 * Process-wide registry of loaded commands, keyed by lowercase command name
 * (including subcommand phrases like "fleet doctor").
 *
 * @internal — test helper; do not import directly in handlers.
 */
export const commands = new Map<string, { desc: CommandDescriptor; path: string }>();

/**
 * Cached WASM command instances, keyed by file path. Populated by the WASM
 * loader in command-registry-wasm.ts; consumed by command-registry-execute.ts.
 *
 * @internal
 */
export const wasmInstances = new Map<string, {
  handle: (ptr: number, len: number) => number;
  memory: WebAssembly.Memory;
  instance: WebAssembly.Instance;
  bridge: WasmBridge;
}>();
