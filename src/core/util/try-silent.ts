/**
 * Run fn, swallow any error, return undefined on failure.
 *
 * Use this ONLY for genuinely-best-effort calls where the caller has
 * decided that failure is acceptable. NEVER use to hide bugs.
 *
 * Why a helper instead of `try { ... } catch {}` inline:
 * 1. Self-documenting: `trySilent(() => x.close())` reads as "best effort
 *    close, ignore failure" — no need to comment WHY there's a catch{}.
 * 2. Greppable: `grep "trySilent" src/` shows every silent-swallow site
 *    in one query, making code review of these decisions tractable.
 * 3. Async variant lives next to it: trySilentAsync.
 */
export function trySilent<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export async function trySilentAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch { return undefined; }
}
