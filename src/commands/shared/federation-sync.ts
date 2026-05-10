/**
 * maw federation sync — active companion to `maw fleet doctor`.
 *
 * Fleet doctor diagnoses config drift. Federation sync *treats* the biggest
 * class of drift — the one that mawui caught tonight — by pulling live
 * identities from every namedPeer's /api/identity and populating the local
 * `config.agents` map automatically.
 *
 * Manually maintained config.agents is the reason `maw hey volt-colab-ml`
 * failed tonight: white grew a new oracle and oracle-world didn't know about
 * it. After this command, any fleet growth on any peer propagates by running
 * `maw federation sync`.
 *
 * Conservative by default: does not overwrite existing routes, does not
 * remove entries (use --prune). --force is required to change a route
 * that already points to a different node.
 *
 * The diff function is pure (no network, no filesystem) so tests can cover
 * every edge case exhaustively without mocking.
 *
 * @barrel — re-exports all public symbols from sub-modules.
 */

export type { PeerIdentity, SyncDiff } from "./federation-identity";
export { hostedAgents } from "./federation-identity";
export { computeSyncDiff } from "./federation-diff";
export { fetchPeerIdentities } from "./federation-fetch";
export { applySyncDiff } from "./federation-apply";
export type { SyncOptions } from "./federation-sync-cli";
export { cmdFederationSync } from "./federation-sync-cli";
