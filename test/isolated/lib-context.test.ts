/**
 * lib/context.ts — Hono DI middleware that injects loadConfig() into c.get("config").
 *
 * Surface is small (2 exports, one module-level cache):
 *   - withContext()   → MiddlewareHandler, lazy-loads + caches config
 *   - refreshContext()→ clears cache so next middleware invocation re-loads
 *
 * Isolated because we mock.module on the only seam the target imports through:
 *   - src/config   (loadConfig — inject a distinguishable config per-test and
 *                   count invocations to prove the lazy-singleton behaviour)
 *
 * mock.module is process-global → capture REAL loadConfig BEFORE install so
 * passthrough (when mockActive === false) doesn't bounce off our wrapper and
 * other suites in the same test run keep their own stubs intact
 * (see #375 pollution catalog).
 * Every passthrough wrapper forwards all args via `(...args)`.
 * os.homedir() caching is N/A here — target makes no home lookups.
 *
 * We don't stand up a real Hono app: withContext's contract is
 *   "call c.set('config', cfg); await next()"
 * which a minimal fake context + spy next() pins precisely. Driving through
 * Hono would add a layer and hide which branch we're exercising.
 */
import {
  describe, test, expect, mock, beforeEach, afterEach, afterAll,
} from "bun:test";
import { join } from "path";
import type { MawConfig } from "../../src/config";

// ─── Gate ───────────────────────────────────────────────────────────────────

let mockActive = false;

// ─── Capture real module refs BEFORE any mock.module installs ───────────────

const _rConfig = await import("../../src/config");
const realLoadConfig = _rConfig.loadConfig;

// ─── Mutable state (reset per-test) ─────────────────────────────────────────

let loadCallCount = 0;
let configSupplier: () => MawConfig = () => ({} as MawConfig);

// ─── Mocks ──────────────────────────────────────────────────────────────────

mock.module(
  join(import.meta.dir, "../../src/config"),
  () => ({
    ..._rConfig,
    loadConfig: (...args: unknown[]) => {
      if (!mockActive) return (realLoadConfig as (...a: unknown[]) => MawConfig)(...args);
      loadCallCount++;
      return configSupplier();
    },
  }),
);

// Import AFTER mock so the target's `loadConfig` ref resolves through the stub.
const { withContext, refreshContext } = await import("../../src/lib/context");

// ─── Fake Hono context ──────────────────────────────────────────────────────

interface FakeCtx {
  store: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
}

function makeCtx(): FakeCtx {
  const store: Record<string, unknown> = {};
  return {
    store,
    set(k, v) { store[k] = v; },
  };
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mockActive = true;
  loadCallCount = 0;
  configSupplier = () => ({ sentinel: "default" } as unknown as MawConfig);
  // Target module has a process-global `_config` cache — clear it before each
  // test or the order of suites changes assertions.
  refreshContext();
});

afterEach(() => {
  mockActive = false;
  refreshContext();
});

afterAll(() => {
  mockActive = false;
  refreshContext();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("withContext()", () => {
  test("returns an async middleware function", () => {
    const mw = withContext();
    expect(typeof mw).toBe("function");
    // MiddlewareHandler is async (c, next) => Promise<void>
    expect(mw.length).toBe(2);
  });

  test("first invocation loads config, sets 'config' on context, awaits next()", async () => {
    const cfg = { sentinel: "first" } as unknown as MawConfig;
    configSupplier = () => cfg;

    const mw = withContext();
    const c = makeCtx();
    let nextCalled = 0;
    const next = async () => { nextCalled++; };

    await mw(c as never, next);

    expect(loadCallCount).toBe(1);
    expect(c.store.config).toBe(cfg);
    expect(nextCalled).toBe(1);
  });

  test("awaits next() — completion order is mw→next→resume", async () => {
    const mw = withContext();
    const c = makeCtx();
    const order: string[] = [];
    const next = async () => {
      order.push("next-start");
      await Promise.resolve();
      order.push("next-end");
    };

    const p = mw(c as never, next);
    order.push("after-call");
    await p;
    order.push("after-await");

    // Synchronous setup (_config load + c.set) runs before the first await;
    // next() is then awaited, so next-end lands before after-await.
    expect(order).toEqual(["next-start", "after-call", "next-end", "after-await"]);
  });

  test("second invocation reuses cached config (lazy singleton)", async () => {
    const first = { sentinel: "first" } as unknown as MawConfig;
    const second = { sentinel: "second" } as unknown as MawConfig;
    let callIdx = 0;
    configSupplier = () => (callIdx++ === 0 ? first : second);

    const mw = withContext();
    const c1 = makeCtx();
    const c2 = makeCtx();
    const noop = async () => {};

    await mw(c1 as never, noop);
    await mw(c2 as never, noop);

    expect(loadCallCount).toBe(1);
    expect(c1.store.config).toBe(first);
    // Cached — c2 gets the SAME instance, not a fresh load.
    expect(c2.store.config).toBe(first);
    expect(c2.store.config).not.toBe(second);
  });

  test("each withContext() call returns an independent middleware, but they share the singleton cache", async () => {
    const cfg = { sentinel: "shared" } as unknown as MawConfig;
    configSupplier = () => cfg;

    const mwA = withContext();
    const mwB = withContext();
    expect(mwA).not.toBe(mwB);

    const cA = makeCtx();
    const cB = makeCtx();
    const noop = async () => {};

    await mwA(cA as never, noop);
    await mwB(cB as never, noop);

    // Module-level _config is shared across every middleware instance.
    expect(loadCallCount).toBe(1);
    expect(cA.store.config).toBe(cfg);
    expect(cB.store.config).toBe(cfg);
  });

  test("propagates errors thrown by next()", async () => {
    configSupplier = () => ({ sentinel: "err-path" } as unknown as MawConfig);
    const mw = withContext();
    const c = makeCtx();
    const boom = new Error("downstream fail");
    const next = async () => { throw boom; };

    await expect(mw(c as never, next)).rejects.toBe(boom);
    // Config still gets set before next() is called.
    expect((c.store.config as { sentinel: string }).sentinel).toBe("err-path");
    expect(loadCallCount).toBe(1);
  });
});

describe("refreshContext()", () => {
  test("clears the cache so the next middleware call re-invokes loadConfig", async () => {
    const first = { sentinel: "before-refresh" } as unknown as MawConfig;
    const second = { sentinel: "after-refresh" } as unknown as MawConfig;
    let callIdx = 0;
    configSupplier = () => (callIdx++ === 0 ? first : second);

    const mw = withContext();
    const c1 = makeCtx();
    const c2 = makeCtx();
    const c3 = makeCtx();
    const noop = async () => {};

    await mw(c1 as never, noop);
    expect(loadCallCount).toBe(1);
    expect(c1.store.config).toBe(first);

    // Without refresh — still cached.
    await mw(c2 as never, noop);
    expect(loadCallCount).toBe(1);
    expect(c2.store.config).toBe(first);

    refreshContext();

    // Post-refresh — loadConfig() fires again and the NEW instance is injected.
    await mw(c3 as never, noop);
    expect(loadCallCount).toBe(2);
    expect(c3.store.config).toBe(second);
    expect(c3.store.config).not.toBe(first);
  });

  test("is idempotent — calling twice with no intervening load is a no-op", async () => {
    const cfg = { sentinel: "idem" } as unknown as MawConfig;
    configSupplier = () => cfg;

    refreshContext();
    refreshContext();

    const mw = withContext();
    const c = makeCtx();
    await mw(c as never, async () => {});

    expect(loadCallCount).toBe(1);
    expect(c.store.config).toBe(cfg);
  });

  test("returns void (no throw on fresh cache)", () => {
    // Called once in beforeEach already — calling again here must not throw
    // even though _config is already null.
    expect(() => refreshContext()).not.toThrow();
    expect(refreshContext()).toBeUndefined();
  });
});
