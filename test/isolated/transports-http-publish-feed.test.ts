import { describe, test, expect, mock } from "bun:test";

import { mockConfigModule } from "../helpers/mock-config";
mock.module("../../src/config", () => mockConfigModule(() => ({
  federationToken: "test-token",
  node: "test",
  peers: [],
})));

// Outcomes are keyed by peer base URL; curlFetch is called with `${peer}/api/feed`.
type Outcome = { kind: "ok" } | { kind: "throw"; error: Error };
const outcomes: Record<string, Outcome> = {};
const calls: string[] = [];
function outcomeFor(fullUrl: string): Outcome | undefined {
  // Match any peer whose URL is a prefix of the fetched URL.
  for (const peer of Object.keys(outcomes)) {
    if (fullUrl.startsWith(peer)) return outcomes[peer];
  }
  return undefined;
}
mock.module("../../src/core/transport/curl-fetch", () => ({
  curlFetch: async (url: string) => {
    calls.push(url);
    const o = outcomeFor(url);
    if (o?.kind === "throw") throw o.error;
    return { ok: true, status: 200, data: { ok: true } };
  },
}));

const { HttpTransport } = await import("../../src/transports/http");
import type { FeedEvent } from "../../src/lib/feed";

const FEED_EVENT: FeedEvent = {
  type: "status",
  from: { oracle: "test", host: "local" },
  timestamp: Date.now(),
  data: { text: "hello" },
} as unknown as FeedEvent;

describe("HttpTransport.publishFeed — per-peer failure visibility (#385 site 4)", () => {
  test("warns once per failed peer, stays silent for successes", async () => {
    const peerA = "http://a.wg:3456"; // succeeds
    const peerB = "http://b.wg:3456"; // throws 401-ish
    const peerC = "http://c.wg:3456"; // times out

    outcomes[peerA] = { kind: "ok" };
    outcomes[peerB] = { kind: "throw", error: new Error("HTTP 401: invalid hmac") };
    outcomes[peerC] = { kind: "throw", error: new Error("connect ETIMEDOUT") };

    const transport = new HttpTransport({ peers: [peerA, peerB, peerC], selfHost: "local" });

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    try {
      await transport.publishFeed(FEED_EVENT);
    } finally {
      console.warn = origWarn;
    }

    // Exactly 2 warnings — one per failed peer, zero for the success.
    expect(warns.length).toBe(2);

    const joined = warns.join("\n");
    // Peer B failure surfaces its URL + reason
    expect(joined).toContain(peerB);
    expect(joined).toContain("401");
    // Peer C failure surfaces its URL + reason
    expect(joined).toContain(peerC);
    expect(joined).toContain("ETIMEDOUT");
    // Peer A (success) must NOT appear in the warnings
    expect(joined).not.toContain(peerA);
  });

  test("all success → no warnings", async () => {
    const peerA = "http://ok1.wg:3456";
    const peerB = "http://ok2.wg:3456";
    outcomes[peerA] = { kind: "ok" };
    outcomes[peerB] = { kind: "ok" };

    const transport = new HttpTransport({ peers: [peerA, peerB], selfHost: "local" });

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    try {
      await transport.publishFeed(FEED_EVENT);
    } finally {
      console.warn = origWarn;
    }
    expect(warns.length).toBe(0);
  });

  test("one peer throwing does not block the others — all are attempted", async () => {
    const peerA = "http://a2.wg:3456";
    const peerB = "http://b2.wg:3456";
    const peerC = "http://c2.wg:3456";

    outcomes[peerA] = { kind: "throw", error: new Error("boom") };
    outcomes[peerB] = { kind: "ok" };
    outcomes[peerC] = { kind: "throw", error: new Error("nope") };

    const before = calls.length;
    const transport = new HttpTransport({ peers: [peerA, peerB, peerC], selfHost: "local" });

    const origWarn = console.warn;
    console.warn = () => {};
    try {
      await transport.publishFeed(FEED_EVENT);
    } finally {
      console.warn = origWarn;
    }

    const thisRunCalls = calls.slice(before);
    expect(thisRunCalls.some((u) => u.startsWith(peerA))).toBe(true);
    expect(thisRunCalls.some((u) => u.startsWith(peerB))).toBe(true);
    expect(thisRunCalls.some((u) => u.startsWith(peerC))).toBe(true);
  });
});
