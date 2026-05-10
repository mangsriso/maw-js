/**
 * trySilent / trySilentAsync — unit tests.
 *
 * These helpers centralize the "best-effort, swallow failure" pattern so
 * silent-swallow sites become greppable. The contract is narrow: return the
 * fn result on success, undefined on throw, never propagate.
 */
import { describe, test, expect } from "bun:test";
import { trySilent, trySilentAsync } from "../src/core/util/try-silent";

describe("trySilent", () => {
  test("returns fn result on success", () => {
    expect(trySilent(() => 42)).toBe(42);
    expect(trySilent(() => "hello")).toBe("hello");
  });

  test("returns undefined on throw", () => {
    expect(trySilent(() => { throw new Error("boom"); })).toBeUndefined();
  });

  test("does NOT propagate the error", () => {
    // If propagation happened, the test would fail with an uncaught throw.
    const run = () => trySilent(() => { throw new Error("nope"); });
    expect(run).not.toThrow();
  });
});

describe("trySilentAsync", () => {
  test("returns resolved value on success", async () => {
    expect(await trySilentAsync(async () => 7)).toBe(7);
  });

  test("returns undefined for rejected promises and does not propagate", async () => {
    const result = await trySilentAsync(async () => { throw new Error("async boom"); });
    expect(result).toBeUndefined();
  });
});
