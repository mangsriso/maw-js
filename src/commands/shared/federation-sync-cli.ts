/**
 * federation-sync-cli.ts — CLI formatting + cmdFederationSync entry point.
 */

import { loadConfig } from "../../config";
import type { MawConfig } from "../../config";
import { fetchPeerIdentities } from "./federation-fetch";
import { computeSyncDiff } from "./federation-diff";
import { applySyncDiff } from "./federation-apply";

const C = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export interface SyncOptions {
  dryRun?: boolean;
  check?: boolean;
  prune?: boolean;
  force?: boolean;
  json?: boolean;
}

/**
 * Lazy save-config shim — same pattern as fleet-doctor, avoids breaking
 * tests that mock.module() the config module globally.
 */
function defaultSave(update: Partial<MawConfig>): void {
  const mod = require("../../config") as typeof import("../../config");
  mod.saveConfig(update);
}

export async function cmdFederationSync(
  opts: SyncOptions = {},
  save: (update: Partial<MawConfig>) => void = defaultSave,
): Promise<void> {
  const config = loadConfig();
  const localNode = config.node || "local";
  const peers = config.namedPeers || [];
  const agents = config.agents || {};

  if (peers.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ node: localNode, diff: null, reason: "no peers" }));
      process.exit(0);
    }
    console.log();
    console.log(`  ${C.gray}no namedPeers configured — nothing to sync${C.reset}`);
    console.log();
    process.exit(0);
  }

  const identities = await fetchPeerIdentities(peers);
  const diff = computeSyncDiff(agents, identities, localNode);

  if (opts.json) {
    console.log(JSON.stringify({ node: localNode, diff, dryRun: !!opts.dryRun }, null, 2));
    const dirty = diff.add.length + diff.stale.length + diff.conflict.length > 0;
    process.exit(opts.check && dirty ? 1 : 0);
  }

  console.log();
  console.log(
    `  ${C.blue}${C.bold}🔄 Federation Sync${C.reset}  ${C.gray}node: ${localNode} · ${peers.length} peers · ${Object.keys(agents).length} agents${C.reset}`,
  );
  console.log();

  // Per-peer section
  for (const id of identities) {
    const label = `${id.peerName} ${C.gray}(${id.url})${C.reset}`;
    if (!id.reachable) {
      console.log(`  ${C.yellow}!${C.reset} ${label}  ${C.gray}unreachable${id.error ? ` — ${id.error}` : ""}${C.reset}`);
      continue;
    }
    const adds = diff.add.filter((a) => a.fromPeer === id.peerName);
    const confs = diff.conflict.filter((c) => c.fromPeer === id.peerName);
    const stale = diff.stale.filter((s) => s.peerNode === id.node);
    console.log(`  ${C.green}●${C.reset} ${label}  ${C.gray}node=${id.node} · ${id.agents.length} oracles${C.reset}`);
    for (const a of adds) {
      console.log(`      ${C.green}+${C.reset} ${a.oracle}  ${C.gray}→ ${a.peerNode}${C.reset}`);
    }
    for (const c of confs) {
      console.log(
        `      ${C.yellow}~${C.reset} ${c.oracle}  ${C.gray}currently ${c.current}, peer claims ${c.proposed}${C.reset}`,
      );
    }
    for (const s of stale) {
      console.log(`      ${C.red}-${C.reset} ${s.oracle}  ${C.gray}no longer hosted on ${s.peerNode}${C.reset}`);
    }
  }
  console.log();

  const dirty = diff.add.length + diff.stale.length + diff.conflict.length > 0;

  if (!dirty) {
    console.log(`  ${C.green}✓${C.reset} in sync. ${C.gray}(${diff.unreachable.length} peers unreachable)${C.reset}`);
    console.log();
    process.exit(0);
  }

  // Conflicts block apply unless --force
  if (diff.conflict.length > 0 && !opts.force && !opts.dryRun && !opts.check) {
    console.log(
      `  ${C.yellow}${diff.conflict.length} conflict${diff.conflict.length === 1 ? "" : "s"}${C.reset} — rerun with ${C.bold}--force${C.reset} to overwrite existing routes.`,
    );
    console.log();
    process.exit(2);
  }

  // Stale entries won't be removed unless --prune
  if (diff.stale.length > 0 && !opts.prune && !opts.dryRun && !opts.check) {
    console.log(
      `  ${C.gray}${diff.stale.length} stale entr${diff.stale.length === 1 ? "y" : "ies"} — rerun with ${C.bold}--prune${C.reset}${C.gray} to remove${C.reset}`,
    );
  }

  if (opts.check) {
    console.log(
      `  ${C.yellow}✖${C.reset} out of sync: ${diff.add.length} add · ${diff.conflict.length} conflict · ${diff.stale.length} stale`,
    );
    console.log();
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(`  ${C.gray}dry run — no changes written${C.reset}`);
    console.log();
    process.exit(0);
  }

  // Apply
  const { agents: nextAgents, applied } = applySyncDiff(agents, diff, {
    force: opts.force,
    prune: opts.prune,
  });

  if (applied.length > 0) {
    save({ agents: nextAgents });
    console.log(`  ${C.green}✓${C.reset} applied ${applied.length} change${applied.length === 1 ? "" : "s"}:`);
    for (const msg of applied) console.log(`     ${msg}`);
    console.log();
  } else {
    console.log(`  ${C.gray}no changes applied (use --force / --prune)${C.reset}`);
    console.log();
  }

  process.exit(0);
}
