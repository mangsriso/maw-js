import {
  closeSync,
  existsSync,
  fstatSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
  constants,
} from "fs";
import { dirname, resolve } from "path";
import { createHash, randomBytes } from "crypto";
import { dlopen, FFIType } from "bun:ffi";

export const CAS_CONFLICT_EXIT = 3;
export const CAS_INPUT_EXIT = 64;
export const CAS_PROTOCOL_EXIT = 69;
export const CAS_IO_EXIT = 74;

export class ConfigTransactionError extends Error {
  constructor(
    readonly code: "SDA-MCP-E-CAS-CONFLICT" | "SDA-MCP-E-CAS-INPUT" | "SDA-MCP-E-CAS-PROTOCOL" | "SDA-MCP-E-CAS-IO",
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PresenceValue {
  present: boolean;
  value?: string;
}

export interface CommandCasRequest {
  protocol: 1;
  name: "codex-*";
  expected: PresenceValue;
  desired: PresenceValue;
}

export interface CommandCasResult {
  protocol: 1;
  result: "updated" | "unchanged" | "conflict";
  before_sha256: string;
  after_sha256: string;
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const libc = dlopen("libc.so.6", {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});
type ConfigTransactionTestHook = (stage: "before-lock" | "after-read", configPath: string) => void;
let configTransactionTestHook: ConfigTransactionTestHook | undefined;
/** @internal process-local synchronization hook; production never installs it. */
export function setConfigTransactionTestHookForTests(hook: ConfigTransactionTestHook | undefined): void {
  configTransactionTestHook = hook;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(sleepCell, 0, 0, milliseconds);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeJsonNumber(token: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const matched = token.match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!matched) return false;
  if (value === 0 && /[1-9]/.test(`${matched[2]}${matched[3] ?? ""}`)) return false;
  if (Number.isInteger(value)) return Number.isSafeInteger(value);
  // JSON decimals are routinely not exactly representable in binary (0.1 is
  // the canonical example).  Accept ordinary finite decimal input while
  // rejecting values whose textual precision exceeds the dependable decimal
  // precision of an IEEE-754 number, or which underflow to zero.
  const significant = `${matched[2]}${matched[3] ?? ""}`.replace(/^0+/, "").replace(/0+$/, "");
  if (significant.length > 15) return false;
  return true;
}

/** JSON.parse does not reject duplicate keys. This small recursive parser does. */
export function parseJsonStrict(text: string, options: { allowUnsafeIntegers?: boolean; maxBytes?: number; maxDepth?: number; maxStringBytes?: number } = {}): unknown {
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 64;
  const maxStringBytes = options.maxStringBytes ?? 1024 * 1024;
  if (Buffer.byteLength(text) > maxBytes) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "JSON input too large");
  }
  let offset = 0;
  const ws = () => { while (/\s/.test(text[offset] ?? "")) offset++; };
  const fail = (message: string): never => {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, message);
  };
  const string = (): string => {
    if (text[offset] !== '"') fail("expected JSON string");
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '"') {
        if (Buffer.byteLength(text.slice(start + 1, offset - 1)) > maxStringBytes) fail("JSON string too large");
        try { return JSON.parse(text.slice(start, offset)); }
        catch { return fail("invalid JSON string"); }
      }
      if (char === "\\") {
        if (offset >= text.length) fail("truncated JSON escape");
        offset++;
      } else if (char && char.charCodeAt(0) < 0x20) {
        fail("unescaped JSON control byte");
      }
    }
    return fail("unterminated JSON string");
  };
  const value = (depth = 0): unknown => {
    if (depth > maxDepth) fail("JSON nesting too deep");
    ws();
    const char = text[offset];
    if (char === '"') return string();
    if (char === "{") {
      offset++;
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      ws();
      if (text[offset] === "}") { offset++; return result; }
      while (true) {
        ws();
        const key = string();
        if (keys.has(key)) fail("duplicate JSON object key");
        keys.add(key);
        ws();
        if (text[offset++] !== ":") fail("expected JSON colon");
        result[key] = value(depth + 1);
        ws();
        const next = text[offset++];
        if (next === "}") return result;
        if (next !== ",") fail("expected JSON comma");
      }
    }
    if (char === "[") {
      offset++;
      const result: unknown[] = [];
      ws();
      if (text[offset] === "]") { offset++; return result; }
      while (true) {
        result.push(value(depth + 1));
        ws();
        const next = text[offset++];
        if (next === "]") return result;
        if (next !== ",") fail("expected JSON comma");
      }
    }
    const rest = text.slice(offset);
    const match = rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) fail("invalid JSON value");
    offset += match[0].length;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed === "number" && (!Number.isFinite(parsed) || (!options.allowUnsafeIntegers
        && !safeJsonNumber(match[0], parsed)))) {
      fail("nonfinite or inexact JSON number");
    }
    return parsed;
  };
  const result = value();
  ws();
  if (offset !== text.length) fail("trailing JSON bytes");
  return result;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, `${label} must be a JSON object`);
  }
}

interface ConfigLock { fd: number }

function assertNoSymlinkAncestors(path: string): void {
  const absolute = resolve(path);
  const parts = absolute.split("/").filter(Boolean);
  let current = "/";
  for (const part of parts.slice(0, -1)) {
    current = current === "/" ? `/${part}` : `${current}/${part}`;
    try {
      const node = lstatSync(current);
      if (node.isSymbolicLink()) throw new Error("symlink ancestor");
    } catch (error: any) {
      if (error?.code === "ENOENT") break;
      if (error instanceof ConfigTransactionError) throw error;
      throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "unsafe maw config ancestor");
    }
  }
}

function acquireLock(configPath: string, timeoutMs: number): ConfigLock {
  assertNoSymlinkAncestors(configPath);
  mkdirSync(dirname(configPath), { recursive: true });
  const lockPath = `${configPath}.transaction.lock`;
  let fd: number;
  try {
    fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    const node = fstatSync(fd);
    if (!node.isFile() || node.uid !== process.getuid?.() || (node.mode & 0o777) !== 0o600) {
      closeSync(fd);
      throw new Error("unsafe config lock node");
    }
  } catch {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "cannot open config lock");
  }
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return { fd };
    if (Date.now() >= deadline) {
      closeSync(fd);
      throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "config lock timeout");
    }
    sleepSync(20);
  }
}

function releaseLock(lock: ConfigLock): void {
  libc.symbols.flock(lock.fd, LOCK_UN);
  closeSync(lock.fd);
}

function safeCurrent(configPath: string, options: { allowMalformed?: boolean } = {}): { exists: boolean; raw: Buffer; mode: number; value: Record<string, unknown> } {
  assertNoSymlinkAncestors(configPath);
  let fd = -1;
  try {
    fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: any) {
    if (error?.code === "ENOENT") return { exists: false, raw: Buffer.from("{}\n"), mode: 0o600, value: {} };
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "cannot safely open maw config");
  }
  const before = fstatSync(fd);
  if (!before.isFile() || before.uid !== process.getuid?.()) {
    closeSync(fd);
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "unsafe maw config node");
  }
  const raw = readFileSync(fd);
  closeSync(fd);
  try {
    const parsed = parseJsonStrict(raw.toString("utf8"));
    assertPlainObject(parsed, "maw config");
    return { exists: true, raw, mode: before.mode & 0o777, value: parsed };
  }
  catch (error) {
    if (options.allowMalformed) return { exists: true, raw, mode: before.mode & 0o777, value: {} };
    if (error instanceof ConfigTransactionError) throw error;
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "invalid maw config JSON");
  }
}

function atomicReplace(
  configPath: string,
  raw: Buffer,
  fileMode: number,
  expected: { exists: boolean; raw: Buffer },
): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const temp = `${configPath}.tmp.${process.pid}.${randomBytes(8).toString("hex")}`;
  let fd = -1;
  try {
    assertNoSymlinkAncestors(configPath);
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, fileMode);
    let written = 0;
    while (written < raw.length) {
      const count = writeSync(fd, raw, written, raw.length - written);
      if (count <= 0) throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "short config write");
      written += count;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = -1;
    // A noncooperating writer does not hold our flock. Detect its completed
    // write at the narrowest useful point before rename; a same-user race after
    // this check remains the documented best-effort residual.
    const observed = safeCurrent(configPath, { allowMalformed: true });
    const stillCurrent = observed.exists === expected.exists && (!expected.exists || observed.raw.equals(expected.raw));
    if (!stillCurrent) {
      throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "config changed outside transaction lock");
    }
    renameSync(temp, configPath);
    const parentFd = openSync(dirname(configPath), "r");
    try { fsyncSync(parentFd); } finally { closeSync(parentFd); }
    if (!readFileSync(configPath).equals(raw)) {
      throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "config post-read mismatch");
    }
  } finally {
    if (fd >= 0) closeSync(fd);
    try { unlinkSync(temp); } catch {}
  }
}

export function mutateConfigTransactional(
  configPath: string,
  mutate: (fresh: Record<string, unknown>) => Record<string, unknown>,
  timeoutMs = 15_000,
): Record<string, unknown> {
  mkdirSync(dirname(configPath), { recursive: true });
  configTransactionTestHook?.("before-lock", configPath);
  const lock = acquireLock(configPath, timeoutMs);
  try {
    const current = safeCurrent(configPath);
    configTransactionTestHook?.("after-read", configPath);
    const desired = mutate(structuredClone(current.value));
    assertPlainObject(desired, "mutated maw config");
    const raw = Buffer.from(`${JSON.stringify(desired, null, 2)}\n`);
    atomicReplace(configPath, raw, current.mode, current);
    return desired;
  } finally {
    releaseLock(lock);
  }
}

/** Fresh exact read under the same cooperative lock used by every writer. */
export function readConfigFreshTransactional(
  configPath: string,
  timeoutMs = 15_000,
): { value: Record<string, unknown>; rawSha256: string } {
  const lock = acquireLock(configPath, timeoutMs);
  try {
    const current = safeCurrent(configPath);
    return { value: structuredClone(current.value), rawSha256: sha256(current.raw) };
  } finally {
    releaseLock(lock);
  }
}

export function replaceWholeConfigTransactional(
  configPath: string,
  value: Record<string, unknown>,
  options: { overwrite: boolean; timeoutMs?: number },
): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const lock = acquireLock(configPath, options.timeoutMs ?? 15_000);
  try {
    const current = safeCurrent(configPath, { allowMalformed: options.overwrite });
    if (!options.overwrite && current.exists) {
      const error: NodeJS.ErrnoException = new Error(`config already exists: ${configPath}`);
      error.code = "EEXIST";
      throw error;
    }
    const desired = structuredClone(value);
    assertPlainObject(desired, "replacement maw config");
    const raw = Buffer.from(`${JSON.stringify(desired, null, 2)}\n`);
    atomicReplace(configPath, raw, current.mode, current);
  } finally {
    releaseLock(lock);
  }
}

function validatePresence(value: unknown, label: string): PresenceValue {
  assertPlainObject(value, label);
  const keys = Object.keys(value).sort();
  if (typeof value.present !== "boolean") {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", CAS_INPUT_EXIT, `${label}.present is required`);
  }
  const expected = value.present ? ["present", "value"] : ["present"];
  if (keys.join("\0") !== expected.sort().join("\0") || (value.present && (typeof value.value !== "string" || value.value.length === 0))) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", CAS_INPUT_EXIT, `${label} has invalid fields`);
  }
  return value as unknown as PresenceValue;
}

export function parseCommandCasRequest(text: string): CommandCasRequest {
  let value: unknown;
  try { value = parseJsonStrict(text, { maxBytes: 64 * 1024, maxDepth: 16, maxStringBytes: 16 * 1024 }); }
  catch (error) {
    if (error instanceof ConfigTransactionError) {
      throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", CAS_INPUT_EXIT, "invalid CAS request JSON");
    }
    throw error;
  }
  assertPlainObject(value, "CAS request");
  if (Object.keys(value).sort().join("\0") !== ["desired", "expected", "name", "protocol"].sort().join("\0")) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", CAS_INPUT_EXIT, "CAS request has unknown fields");
  }
  if (value.protocol !== 1) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-PROTOCOL", CAS_PROTOCOL_EXIT, "unsupported CAS protocol");
  }
  if (value.name !== "codex-*") {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", CAS_INPUT_EXIT, "unsupported command field");
  }
  return {
    protocol: 1,
    name: "codex-*",
    expected: validatePresence(value.expected, "expected"),
    desired: validatePresence(value.desired, "desired"),
  };
}

function field(config: Record<string, unknown>, name: string): PresenceValue {
  const commands = config.commands;
  if (Object.prototype.hasOwnProperty.call(config, "commands")
      && (!commands || typeof commands !== "object" || Array.isArray(commands))) {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "existing commands is not an object");
  }
  if (!commands) return { present: false };
  const value = (commands as Record<string, unknown>)[name];
  if (Object.prototype.hasOwnProperty.call(commands, name) && typeof value !== "string") {
    throw new ConfigTransactionError("SDA-MCP-E-CAS-IO", CAS_IO_EXIT, "existing managed command is not a string");
  }
  return typeof value === "string" ? { present: true, value } : { present: false };
}

function equal(a: PresenceValue, b: PresenceValue): boolean {
  return a.present === b.present && (!a.present || a.value === b.value);
}

export function commandCas(configPath: string, request: CommandCasRequest, timeoutMs = 15_000): CommandCasResult {
  const lock = acquireLock(configPath, timeoutMs);
  try {
    const current = safeCurrent(configPath);
    const observed = field(current.value, request.name);
    if (equal(observed, request.desired)) {
      const hash = sha256(current.raw);
      return { protocol: 1, result: "unchanged", before_sha256: hash, after_sha256: hash };
    }
    if (!equal(observed, request.expected)) {
      const hash = sha256(current.raw);
      return { protocol: 1, result: "conflict", before_sha256: hash, after_sha256: hash };
    }
    const desired = structuredClone(current.value);
    const commands = desired.commands && typeof desired.commands === "object" && !Array.isArray(desired.commands)
      ? structuredClone(desired.commands as Record<string, unknown>)
      : {};
    if (request.desired.present) commands[request.name] = request.desired.value!;
    else delete commands[request.name];
    desired.commands = commands;
    const nextRaw = Buffer.from(`${JSON.stringify(desired, null, 2)}\n`);
    atomicReplace(configPath, nextRaw, current.mode, current);
    return {
      protocol: 1,
      result: "updated",
      before_sha256: sha256(current.raw),
      after_sha256: sha256(nextRaw),
    };
  } finally {
    releaseLock(lock);
  }
}
