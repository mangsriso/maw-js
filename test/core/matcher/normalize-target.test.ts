import { describe, test, expect } from "bun:test";
import { normalizeTarget } from "../../../src/core/matcher/normalize-target";

describe("normalizeTarget", () => {
  test("plain name passes through unchanged", () => {
    expect(normalizeTarget("token-oracle")).toBe("token-oracle");
  });

  test("single trailing slash is stripped", () => {
    // The repro case for #342: tab-completed `token-oracle/` must resolve.
    expect(normalizeTarget("token-oracle/")).toBe("token-oracle");
  });

  test("multiple trailing slashes are stripped", () => {
    expect(normalizeTarget("token-oracle//")).toBe("token-oracle");
  });

  test("trailing /.git is stripped", () => {
    expect(normalizeTarget("token-oracle/.git")).toBe("token-oracle");
  });

  test("trailing /.git/ is stripped (both the suffix and the slash)", () => {
    expect(normalizeTarget("token-oracle/.git/")).toBe("token-oracle");
  });

  test("empty string stays empty (caller surfaces usage error)", () => {
    expect(normalizeTarget("")).toBe("");
  });
});
