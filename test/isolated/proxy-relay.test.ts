/**
 * proxy-relay.ts — outbound HTTP relay + peer URL resolution (primary).
 * proxy-routes.ts — POST /api/proxy + GET /api/proxy/session (bonus branches).
 *
 * proxy-relay's `relayHttpToPeer` is the only uncovered function on this
 * surface at the start of iteration fourteen (21% line cov). It stitches
 * three seams:
 *   - loadConfig         (federationToken injection from src/config)
 *   - signHeaders        (real — outgoing HMAC is deterministic, why mock it)
 *   - globalThis.fetch   (network — replaced per-test, restored in afterEach)
 *
 * Isolated because we mock.module on one seam:
 *   - src/config   (loadConfig — inject federationToken + namedPeers +
 *                   proxy.shellPeers per-test)
 *
 * Real refs are captured BEFORE mock.module installs so other isolated
 * suites that import src/config keep their own stubs intact (process-global
 * registry, gated by `mockActive`; see #375 pollution catalog).
 * Every passthrough wrapper forwards all args via `(...args)`.
 *
 * globalThis.fetch is replaced with a per-test stub and restored in
 * afterEach — NEVER cross-test, or the next suite that hits the network
 * sees our stub (pollution). A real `fetch` is what gets called on
 * passthrough so the restore matters even when tests pass.
 *
 * signHeaders is intentionally NOT mocked: it's the cleanest way to prove
 * proxy-relay's outbound signing is self-consistent (sign→emit→verify
 * round-trip is already exhaustively tested in federation-auth.test.ts;
 * here we only need to confirm the headers land on the outbound request).
 *
 * proxy-routes coverage is a bonus — driven through Elysia's app.handle()
 * with a real Elysia instance + proxyApi plugin, matching the pattern
 * already in test/proxy.test.ts but exercising branches that the existing
 * suite skips (happy-path relay, relay exception, mutation allowlisted,
 * non-object JSON body).
 */
import {
  describe, test, expect, mock, beforeEach, afterEach, afterAll,
} from "bun:test";
import { join } from "path";
import { Elysia } from "elysia";
import type { MawConfig } from "../../src/config";
import { verify } from "../../src/lib/federation-auth";

// ─── Gate ───────────────────────────────────────────────────────────────────

let mockActive = false;

// ─── Capture real module refs BEFORE any mock.module installs ───────────────

const _rConfig = await import("../../src/config");
const realLoadConfig = _rConfig.loadConfig;

// ─── Mutable state (reset per-test) ─────────────────────────────────────────

let configStore: Partial<MawConfig> & { proxy?: { shellPeers?: string[] } } = {};

// ─── Mocks ──────────────────────────────────────────────────────────────────

mock.module(
  join(import.meta.dir, "../../src/config"),
  () => ({
    ..._rConfig,
    loadConfig: (...args: unknown[]) =>
      mockActive
        ? (configStore as MawConfig)
        : (realLoadConfig as (...a: unknown[]) => MawConfig)(...args),
  }),
);

// NB: import targets AFTER mocks so their import graph resolves through stubs.
const { relayHttpToPeer, resolveProxyPeerUrl } = await import("../../src/api/proxy-relay");
const { proxyApi } = await import("../../src/api/proxy-routes");

// ─── fetch harness ──────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

const realFetch = globalThis.fetch;
let fetchCalls: FetchCall[] = [];
let nextResponse: () => Response = () =>
  new Response("default-stub-body", { status: 200, headers: { "content-type": "application/json" } });

function installFetchStub(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : (input as Request).url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      if (rawHeaders) {
        // Headers init can be Record or Headers; iterate both forms. Always
        // normalise key case to lowercase so assertions don't depend on
        // whether proxy-relay used "Content-Type" (title) or "content-type".
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        } else if (Array.isArray(rawHeaders)) {
          for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = v;
        } else {
          for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
        }
      }
      const body = typeof init?.body === "string" ? init.body : (init?.body === undefined ? undefined : String(init.body));
      fetchCalls.push({ url, method, headers, body });
      return Promise.resolve(nextResponse());
    }) as typeof fetch;
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mockActive = true;
  configStore = {};
  fetchCalls = [];
  nextResponse = () =>
    new Response("default-stub-body", { status: 200, headers: { "content-type": "application/json" } });
  installFetchStub();
});

afterEach(() => {
  mockActive = false;
  restoreFetch();
});

afterAll(() => {
  mockActive = false;
  restoreFetch();
});

// ════════════════════════════════════════════════════════════════════════════
// resolveProxyPeerUrl — named peer lookup (only branch uncovered at baseline)
// ════════════════════════════════════════════════════════════════════════════

describe("resolveProxyPeerUrl — config.namedPeers branch", () => {
  test("known named peer → returns its configured URL", () => {
    configStore = {
      namedPeers: [
        { name: "white", url: "http://white.lan:3456" },
        { name: "oracle-world", url: "http://oracle-world.lan:3456" },
      ],
    };
    expect(resolveProxyPeerUrl("white")).toBe("http://white.lan:3456");
    expect(resolveProxyPeerUrl("oracle-world")).toBe("http://oracle-world.lan:3456");
  });

  test("named peer beats host:port heuristic when both could match", () => {
    // Name "host:1234" — the regex would also match as bare host:port. The
    // namedPeers lookup runs FIRST (line 12-13) so the configured URL wins.
    configStore = {
      namedPeers: [{ name: "host:1234", url: "http://override.example:9999" }],
    };
    expect(resolveProxyPeerUrl("host:1234")).toBe("http://override.example:9999");
  });

  test("unknown name with empty namedPeers → falls through to host:port / URL check", () => {
    configStore = { namedPeers: [] };
    expect(resolveProxyPeerUrl("10.0.0.7:3456")).toBe("http://10.0.0.7:3456");
    expect(resolveProxyPeerUrl("https://peer.example:3456")).toBe("https://peer.example:3456");
    expect(resolveProxyPeerUrl("ghost-name")).toBeNull();
  });

  test("namedPeers absent from config (undefined) → defaults to [] without throwing", () => {
    configStore = {}; // no namedPeers field at all
    expect(resolveProxyPeerUrl("anything-bare")).toBeNull();
    expect(resolveProxyPeerUrl("10.0.0.7:3456")).toBe("http://10.0.0.7:3456");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// relayHttpToPeer — URL + method plumbing
// ════════════════════════════════════════════════════════════════════════════

describe("relayHttpToPeer — URL + method plumbing", () => {
  test("URL is peerUrl + path concatenated verbatim (no rewriting)", async () => {
    await relayHttpToPeer("http://white.lan:3456", "GET", "/api/config", undefined);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("http://white.lan:3456/api/config");
  });

  test("URL concatenation preserves query strings on the path", async () => {
    await relayHttpToPeer("http://white.lan:3456", "GET", "/api/feed?limit=100", undefined);
    expect(fetchCalls[0].url).toBe("http://white.lan:3456/api/feed?limit=100");
  });

  test("method is upper-cased before dispatch (accepts 'get' / 'Post')", async () => {
    await relayHttpToPeer("http://peer", "get", "/api/config", undefined);
    expect(fetchCalls[0].method).toBe("GET");

    await relayHttpToPeer("http://peer", "Post", "/api/config", "{}");
    expect(fetchCalls[1].method).toBe("POST");
  });

  test("unknown methods still forward upper-cased (validation lives at route layer)", async () => {
    await relayHttpToPeer("http://peer", "trace", "/api/config", undefined);
    expect(fetchCalls[0].method).toBe("TRACE");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// relayHttpToPeer — HMAC signing seam (federationToken)
// ════════════════════════════════════════════════════════════════════════════

describe("relayHttpToPeer — federationToken signing", () => {
  test("no federationToken configured → no X-Maw-* headers emitted", async () => {
    configStore = {}; // token absent
    await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    const h = fetchCalls[0].headers;
    expect(h["x-maw-signature"]).toBeUndefined();
    expect(h["x-maw-timestamp"]).toBeUndefined();
  });

  test("federationToken present → X-Maw-Timestamp + X-Maw-Signature emitted", async () => {
    configStore = { federationToken: "0123456789abcdef-relay-test-token" };
    await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    const h = fetchCalls[0].headers;
    expect(h["x-maw-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h["x-maw-timestamp"]).toMatch(/^\d+$/);
  });

  test("emitted signature verifies against the SAME method/path/timestamp (self-consistent)", async () => {
    const token = "0123456789abcdef-relay-roundtrip";
    configStore = { federationToken: token };
    await relayHttpToPeer("http://peer", "post", "/api/send", "{}");
    const h = fetchCalls[0].headers;
    const ts = parseInt(h["x-maw-timestamp"], 10);
    // Signature is computed over UPPER(method):path:ts — confirm by verify().
    expect(verify(token, "POST", "/api/send", ts, h["x-maw-signature"])).toBe(true);
    // And crucially NOT against the lowercased pre-upper method:
    expect(verify(token, "post", "/api/send", ts, h["x-maw-signature"])).toBe(false);
  });

  test("signature is over path only — peerUrl is NOT part of the HMAC payload", async () => {
    const token = "0123456789abcdef-peer-url-not-signed";
    configStore = { federationToken: token };
    await relayHttpToPeer("http://peer-A", "GET", "/api/config", undefined);
    await relayHttpToPeer("http://totally-different-peer-B", "GET", "/api/config", undefined);
    // Skew aside, two emissions with the same method+path should verify
    // against the SAME token regardless of peerUrl.
    for (const call of fetchCalls) {
      const ts = parseInt(call.headers["x-maw-timestamp"], 10);
      expect(verify(token, "GET", "/api/config", ts, call.headers["x-maw-signature"])).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// relayHttpToPeer — body + Content-Type handling per method class
// ════════════════════════════════════════════════════════════════════════════

describe("relayHttpToPeer — body transform by method class", () => {
  test("GET with body provided → body is STRIPPED before fetch (readonly method)", async () => {
    await relayHttpToPeer("http://peer", "GET", "/api/config", '{"should":"not send"}');
    expect(fetchCalls[0].body).toBeUndefined();
  });

  test("HEAD with body → body stripped, no Content-Type header", async () => {
    await relayHttpToPeer("http://peer", "HEAD", "/api/config", '{"x":1}');
    expect(fetchCalls[0].body).toBeUndefined();
    expect(fetchCalls[0].headers["content-type"]).toBeUndefined();
  });

  test("OPTIONS with body → body stripped, no Content-Type header", async () => {
    await relayHttpToPeer("http://peer", "OPTIONS", "/api/config", '{"x":1}');
    expect(fetchCalls[0].body).toBeUndefined();
    expect(fetchCalls[0].headers["content-type"]).toBeUndefined();
  });

  test("POST with body → body forwarded verbatim + Content-Type: application/json", async () => {
    await relayHttpToPeer("http://peer", "POST", "/api/ping", '{"hello":"world"}');
    expect(fetchCalls[0].body).toBe('{"hello":"world"}');
    expect(fetchCalls[0].headers["content-type"]).toBe("application/json");
  });

  test("PUT with body → body forwarded + Content-Type set", async () => {
    await relayHttpToPeer("http://peer", "PUT", "/api/ping", "raw-put-body");
    expect(fetchCalls[0].body).toBe("raw-put-body");
    expect(fetchCalls[0].headers["content-type"]).toBe("application/json");
  });

  test("PATCH + DELETE with body → body forwarded + Content-Type set", async () => {
    await relayHttpToPeer("http://peer", "PATCH", "/api/ping", "p");
    await relayHttpToPeer("http://peer", "DELETE", "/api/ping", "d");
    expect(fetchCalls[0].body).toBe("p");
    expect(fetchCalls[0].headers["content-type"]).toBe("application/json");
    expect(fetchCalls[1].body).toBe("d");
    expect(fetchCalls[1].headers["content-type"]).toBe("application/json");
  });

  test("POST with body=undefined → no Content-Type header (the !== undefined guard)", async () => {
    // Load-bearing: proxy-relay gates Content-Type on `body !== undefined`.
    // A missing body on POST must NOT produce a spurious Content-Type that
    // could confuse the upstream peer parser.
    await relayHttpToPeer("http://peer", "POST", "/api/ping", undefined);
    expect(fetchCalls[0].body).toBeUndefined();
    expect(fetchCalls[0].headers["content-type"]).toBeUndefined();
  });

  test("lowercase 'post' still hits the mutating branch (case-insensitive classification)", async () => {
    await relayHttpToPeer("http://peer", "post", "/api/ping", "x");
    expect(fetchCalls[0].method).toBe("POST");
    expect(fetchCalls[0].body).toBe("x");
    expect(fetchCalls[0].headers["content-type"]).toBe("application/json");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// relayHttpToPeer — response filtering (only safe headers pass through)
// ════════════════════════════════════════════════════════════════════════════

describe("relayHttpToPeer — response header allowlist", () => {
  test("allowed response headers (content-type/cache-control/etag/last-modified) are forwarded", async () => {
    nextResponse = () =>
      new Response("body-text", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=60",
          "etag": '"abc123"',
          "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
        },
      });
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(out.headers).toEqual({
      "content-type": "application/json",
      "cache-control": "max-age=60",
      "etag": '"abc123"',
      "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
    });
  });

  test("Set-Cookie on peer response is STRIPPED (never leaks upstream auth state)", async () => {
    nextResponse = () =>
      new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "set-cookie": "upstream_session=leaky; HttpOnly",
        },
      });
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(out.headers["set-cookie"]).toBeUndefined();
    expect(out.headers["content-type"]).toBe("text/plain");
  });

  test("Authorization / WWW-Authenticate / X-* headers on peer response are stripped", async () => {
    nextResponse = () =>
      new Response("ok", {
        status: 200,
        headers: {
          "authorization": "Bearer upstream-token",
          "www-authenticate": "Basic realm=internal",
          "x-internal-flag": "true",
          "content-type": "application/json",
        },
      });
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(out.headers["authorization"]).toBeUndefined();
    expect(out.headers["www-authenticate"]).toBeUndefined();
    expect(out.headers["x-internal-flag"]).toBeUndefined();
    expect(out.headers["content-type"]).toBe("application/json");
  });

  test("missing allowed header on peer response → not added as empty string (truthy filter)", async () => {
    nextResponse = () => new Response("", { status: 204 }); // no headers set
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(out.headers).toEqual({});
  });
});

// ════════════════════════════════════════════════════════════════════════════
// relayHttpToPeer — RelayResult shape (status / body / elapsedMs)
// ════════════════════════════════════════════════════════════════════════════

describe("relayHttpToPeer — return shape", () => {
  test("propagates peer status verbatim (200 / 404 / 500)", async () => {
    for (const code of [200, 404, 500] as const) {
      nextResponse = () => new Response("b", { status: code });
      const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
      expect(out.status).toBe(code);
    }
  });

  test("returns response body as text (await response.text())", async () => {
    nextResponse = () => new Response('{"from":"peer"}', { status: 200 });
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(out.body).toBe('{"from":"peer"}');
  });

  test("elapsedMs is a finite non-negative number (Date.now() delta)", async () => {
    const out = await relayHttpToPeer("http://peer", "GET", "/api/config", undefined);
    expect(typeof out.elapsedMs).toBe("number");
    expect(Number.isFinite(out.elapsedMs)).toBe(true);
    expect(out.elapsedMs).toBeGreaterThanOrEqual(0);
    // Network stub resolves synchronously — should be tiny.
    expect(out.elapsedMs).toBeLessThan(5000);
  });

  test("fetch rejection (network failure) propagates — caller (route) handles the 502", async () => {
    nextResponse = () => { throw new Error("econnrefused: downstream unreachable"); };
    await expect(
      relayHttpToPeer("http://peer", "GET", "/api/config", undefined),
    ).rejects.toThrow(/econnrefused/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BONUS: proxy-routes.ts — route branches not hit by test/proxy.test.ts
// ════════════════════════════════════════════════════════════════════════════

describe("proxy-routes (bonus) — POST /api/proxy branches", () => {
  function makeApp(): Elysia {
    return new Elysia({ prefix: "/api" })
      .onError(({ code, set }) => {
        if (code === "PARSE") {
          set.status = 400;
          return { error: "invalid_body" };
        }
      })
      .use(proxyApi);
  }

  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // bypass session cookie for these bonus flows
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  test("happy path — GET /api/config through allowlisted peer returns relayed body", async () => {
    configStore = {
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
    };
    nextResponse = () =>
      new Response('{"ok":true,"from":"white"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const res = await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "GET",
        path: "/api/config",
        signature: "[local:mawjs-oracle]",
      }),
    }));

    expect(res.status).toBe(200);
    const payload = await res.json() as {
      status: number; body: string; from: string; elapsed_ms: number; trust_tier: string;
    };
    expect(payload.status).toBe(200);
    expect(payload.body).toBe('{"ok":true,"from":"white"}');
    expect(payload.from).toBe("http://white.lan:3456");
    expect(payload.trust_tier).toBe("readonly_method");
    expect(typeof payload.elapsed_ms).toBe("number");

    // And the upstream fetch was actually dispatched at peerUrl+path.
    expect(fetchCalls[0].url).toBe("http://white.lan:3456/api/config");
  });

  test("mutation ALLOWED when origin is in proxy.shellPeers (non-anon) — exercises happy-path mutation branch", async () => {
    configStore = {
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
      proxy: { shellPeers: ["trusted-host"] },
    };
    nextResponse = () => new Response('{"ok":true}', { status: 200 });

    const res = await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "POST",
        path: "/api/ping",
        body: '{"hi":1}',
        signature: "[trusted-host:mawjs-oracle]",
      }),
    }));

    expect(res.status).toBe(200);
    const payload = await res.json() as { trust_tier: string; body: string };
    expect(payload.trust_tier).toBe("shell_allowlisted");
    expect(payload.body).toBe('{"ok":true}');

    // The outgoing fetch carried the mutating method + body.
    expect(fetchCalls[0].method).toBe("POST");
    expect(fetchCalls[0].body).toBe('{"hi":1}');
  });

  test("mutation_denied for non-anon origin NOT in shellPeers (line 74 non-anon hint branch)", async () => {
    configStore = {
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
      proxy: { shellPeers: ["somebody-else"] },
    };
    const res = await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "POST",
        path: "/api/ping",
        body: "{}",
        signature: "[not-trusted-host:some-agent]", // NOT anon, NOT in list
      }),
    }));
    expect(res.status).toBe(403);
    const payload = await res.json() as { error: string; origin: string; hint: string; method: string };
    expect(payload.error).toBe("mutation_denied");
    expect(payload.origin).toBe("not-trusted-host");
    expect(payload.method).toBe("POST");
    // Non-anon hint (not the anonymous-visitors one):
    expect(payload.hint).toContain("config.proxy.shellPeers");
    expect(payload.hint).not.toContain("anonymous browser visitors");
  });

  test("502 relay_failed when upstream fetch throws — exercises the catch branch", async () => {
    configStore = {
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
    };
    nextResponse = () => { throw new Error("EHOSTUNREACH white.lan"); };

    const res = await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "GET",
        path: "/api/config",
        signature: "[local:mawjs-oracle]",
      }),
    }));

    expect(res.status).toBe(502);
    const payload = await res.json() as { error: string; peer: string; reason: string };
    expect(payload.error).toBe("relay_failed");
    expect(payload.peer).toBe("http://white.lan:3456");
    expect(payload.reason).toContain("EHOSTUNREACH");
  });

  test("502 relay_failed reason falls back to String(err) when error has no .message", async () => {
    configStore = {
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
    };
    // Non-Error throwable — exercises the `err?.message ?? String(err)` branch.
    nextResponse = () => { throw "plain-string-thrown"; };

    const res = await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "GET",
        path: "/api/config",
        signature: "[local:mawjs-oracle]",
      }),
    }));
    expect(res.status).toBe(502);
    const payload = await res.json() as { reason: string };
    expect(payload.reason).toBe("plain-string-thrown");
  });

  test("relay signs outbound with configured federationToken (end-to-end through the route)", async () => {
    const token = "0123456789abcdef-route-signing-check";
    configStore = {
      federationToken: token,
      namedPeers: [{ name: "white", url: "http://white.lan:3456" }],
    };
    await makeApp().handle(new Request("http://localhost/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        peer: "white",
        method: "GET",
        path: "/api/config",
        signature: "[local:mawjs-oracle]",
      }),
    }));

    expect(fetchCalls).toHaveLength(1);
    const h = fetchCalls[0].headers;
    const ts = parseInt(h["x-maw-timestamp"], 10);
    expect(verify(token, "GET", "/api/config", ts, h["x-maw-signature"])).toBe(true);
  });
});
