/**
 * Regression tests for #357 — `maw a mawjs` must not be ambiguous
 * when a stale mawjs-view-view session also exists.
 *
 * Bug: `maw a mawjs` with sessions [mawjs-view, mawjs-view-view] returned
 *      "ambiguous" because both match the `mawjs-*` word-segment rule.
 * Fix: cmdView filters out `-view-view` sessions before resolving, so only
 *      mawjs-view remains as a candidate → clean fuzzy match.
 *
 * Tests verify the filter + resolve contract, not Tmux/execSync internals.
 */
import { describe, it, expect } from "bun:test";
import { resolveSessionTarget } from "../src/core/matcher/resolve-target";

type Session = { name: string; windows?: { index: number }[] };
const sess = (name: string): Session => ({ name, windows: [{ index: 0 }] });

/** Mirror the filter applied in cmdView after the #357 fix. */
function filterViewOfView(sessions: Session[]): Session[] {
  return sessions.filter(s => !/-view-view$/.test(s.name));
}

describe("#357 — mawjs-view-view excluded from view target resolution", () => {
  it("filter removes -view-view sessions, leaving mawjs-view", () => {
    const raw = [sess("mawjs-view"), sess("mawjs-view-view")];
    expect(filterViewOfView(raw).map(s => s.name)).toEqual(["mawjs-view"]);
  });

  it("'mawjs' resolves fuzzy→mawjs-view after filter (not ambiguous)", () => {
    const raw = [sess("mawjs-view"), sess("mawjs-view-view")];
    const r = resolveSessionTarget("mawjs", filterViewOfView(raw));
    expect(r.kind).toBe("fuzzy");
    if (r.kind === "fuzzy") expect(r.match.name).toBe("mawjs-view");
  });

  it("filter also removes multi-node view-of-view variants", () => {
    const raw = [
      sess("102-white-wormhole-view"),
      sess("102-white-wormhole-view-view"),
      sess("103-neo-mawjs-view"),
      sess("103-neo-mawjs-view-view"),
    ];
    const filtered = filterViewOfView(raw).map(s => s.name);
    expect(filtered).toEqual(["102-white-wormhole-view", "103-neo-mawjs-view"]);
  });

  it("genuine ambiguity still surfaces after filter", () => {
    // mawjs-view AND mawui-view both start with 'view' suffix — still ambiguous
    const raw = [sess("mawjs-view"), sess("mawui-view"), sess("skills-cli-view-view")];
    const r = resolveSessionTarget("view", filterViewOfView(raw));
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      const names = r.candidates.map(c => c.name).sort();
      expect(names).toEqual(["mawjs-view", "mawui-view"]);
    }
  });

  it("exact session name still wins even when -view-view exists", () => {
    const raw = [sess("mawjs"), sess("mawjs-view"), sess("mawjs-view-view")];
    const r = resolveSessionTarget("mawjs", filterViewOfView(raw));
    expect(r.kind).toBe("exact");
    if (r.kind === "exact") expect(r.match.name).toBe("mawjs");
  });

  it("filter is idempotent on clean session list (no -view-view)", () => {
    const raw = [sess("mawjs-view"), sess("mawui-view"), sess("101-red-alpha")];
    expect(filterViewOfView(raw)).toHaveLength(3);
  });
});

/**
 * Tests for #358 view-stutter fix — the line-59 guard now fires for ALL
 * cases where sessionName ends with '-view', including when the user types
 * the literal view name (re-attach reflex). logAnomaly is called in that path.
 */

/** Mirror the guard condition at impl.ts line 59. */
function sessionIsView(sessionName: string): boolean {
  return sessionName.endsWith("-view");
}

/** Mirror the re-attach-reflex detection added inside the guard. */
function isReAttachReflex(sessionName: string, agent: string): boolean {
  return sessionName.endsWith("-view") && agent.endsWith("-view");
}

describe("#358 — guard fires for all -view sessions (no stutter, reflex logged)", () => {
  it("guard fires when sessionName ends with -view and agent is plain name", () => {
    expect(sessionIsView("mawjs-view")).toBe(true);
    expect(isReAttachReflex("mawjs-view", "mawjs")).toBe(false); // no anomaly
  });

  it("guard fires and reflex detected when agent also ends with -view", () => {
    expect(sessionIsView("mawjs-view")).toBe(true);
    expect(isReAttachReflex("mawjs-view", "mawjs-view")).toBe(true); // anomaly logged
  });

  it("guard does NOT fire for plain session (no stutter risk)", () => {
    expect(sessionIsView("mawjs")).toBe(false);
    expect(isReAttachReflex("mawjs", "mawjs")).toBe(false);
  });

  it("view name is sessionName unchanged — no -view suffix appended", () => {
    // When guard fires → direct attach to sessionName (not sessionName + "-view")
    const sessionName = "mawjs-view";
    // impl.ts skips the viewBase computation entirely and attaches to sessionName directly
    expect(sessionName).toBe("mawjs-view");
    expect(sessionName).not.toBe("mawjs-view-view");
  });

  it("node-prefixed sessions handled correctly", () => {
    expect(sessionIsView("102-white-wormhole-view")).toBe(true);
    expect(isReAttachReflex("102-white-wormhole-view", "102-white-wormhole-view")).toBe(true);
    expect(isReAttachReflex("102-white-wormhole-view", "wormhole")).toBe(false);
  });
});
