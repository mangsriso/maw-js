/**
 * Plugin manifest — parse, validate, and load plugin.json descriptors.
 *
 * Validation rules:
 *   name         — /^[a-z0-9-]+$/
 *   version      — semver (N.N.N with optional pre-release/build)
 *   sdk          — semver range: *, N.N.N, ^N.N.N, ~N.N.N, >=N.N.N, etc.
 *   wasm         — relative path; file must exist on disk relative to manifest dir
 *   target       — optional: "js" (Phase A); "wasm" reserved for Phase C
 *   capabilities — optional: string[] of "namespace:verb"; unknown ns = warning
 *   artifact     — optional: { path, sha256 } descriptor for built plugins
 *
 * Back-compat: legacy manifests without target/capabilities/artifact still
 * parse — the loader treats them as target "js", capabilities [], artifact null.
 */

export { KNOWN_CAPABILITY_NAMESPACES } from "./manifest-constants";
export { parseManifest } from "./manifest-parse";
export { loadManifestFromDir } from "./manifest-load";
