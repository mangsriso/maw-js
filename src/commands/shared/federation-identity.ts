/**
 * federation-identity.ts — PeerIdentity + SyncDiff types and hostedAgents helper.
 * Pure — no I/O, no network.
 */

// ---------- Pure identity helpers ----------

/**
 * Compute the set of oracles this node claims to host locally.
 *
 * Pure — lives here (not in src/api/federation.ts) so tests can import it
 * without pulling in the full API module and its `../snapshot` chain. Under
 * bun 1.3.10's stricter mock isolation, importing from api/federation was
 * transitively loading snapshot.ts before snapshot.test.ts could mock paths,
 * which caused CI-only snapshot test failures.
 *
 * We accept TWO conventions in config.agents:
 *   - `'<nodeName>'` — explicit ("white")
 *   - `'local'`     — shorthand ("me, whoever I am")
 *
 * Both mean "hosted here" and both must be reported, otherwise peers running
 * `maw federation sync` will false-flag oracles as stale just because the
 * local node wrote `'local'` instead of its own node name. (Discovered on
 * 2026-04-11: `volt-colab-ml: 'local'` on white silently dropped, so
 * oracle-world saw a stale-delete it should never have seen.)
 */
export function hostedAgents(agents: Record<string, string>, node: string): string[] {
  return Object.entries(agents)
    .filter(([, n]) => n === node || n === "local")
    .map(([name]) => name);
}

// ---------- Types ----------

export interface PeerIdentity {
  /** namedPeer.name — what the user wrote in config */
  peerName: string;
  /** Peer's advertised URL */
  url: string;
  /** identity.node from /api/identity — the authoritative routing key */
  node: string;
  /** identity.agents — oracle names the peer hosts locally */
  agents: string[];
  /** Whether /api/identity responded with valid data */
  reachable: boolean;
  /** Error message if unreachable */
  error?: string;
}

export interface SyncDiff {
  /** Oracles present on a reachable peer but not in local config.agents */
  add: Array<{ oracle: string; peerNode: string; fromPeer: string }>;
  /** Oracles routed locally to node X, but peer X no longer hosts them */
  stale: Array<{ oracle: string; peerNode: string }>;
  /** Oracles routed locally to node X, but peer Y claims to host them too */
  conflict: Array<{
    oracle: string;
    current: string;
    proposed: string;
    fromPeer: string;
  }>;
  /** Peers we couldn't reach — their oracles are invisible to this sync */
  unreachable: Array<{ peerName: string; url: string; error?: string }>;
}
