/**
 * Cron trigger support (#209 PR γ).
 *
 * "cron" is a TriggerEvent that fires on a crontab schedule. This module
 * ships the WIRING only: the TriggerEvent union admits "cron", `fire("cron")`
 * dispatches configured cron triggers, and `wouldFireAt()` parses a crontab
 * expression for dry-run inspection. It does NOT run a daemon — external
 * scheduling (system cron, systemd timer, a future maw-cron process) must
 * invoke `fire("cron")` at trigger times.
 */

/**
 * Parse a single crontab field ("minute" / "hour" / etc.) into a Set of
 * matching values. Supports `*`, number, list (`1,3,5`), range (`1-5`),
 * step (e.g. star-slash-2 or `1-5/2`). Throws on out-of-range or malformed input.
 */
export function parseCronField(expr: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    let step = 1;
    let body = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      step = parseInt(part.slice(slashIdx + 1), 10);
      body = part.slice(0, slashIdx);
      if (!Number.isFinite(step) || step < 1) {
        throw new Error(`invalid step in cron field "${expr}"`);
      }
    }
    let start: number, end: number;
    if (body === "*") {
      start = min; end = max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-").map((n) => parseInt(n, 10));
      start = a; end = b;
    } else {
      const n = parseInt(body, 10);
      start = n; end = n;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
      throw new Error(`invalid range "${body}" in cron field "${expr}" (expected ${min}-${max})`);
    }
    for (let i = start; i <= end; i += step) out.add(i);
  }
  return out;
}

/**
 * Compute the next moment a 5-field crontab expression would fire after `now`.
 *
 * Returns a Date strictly greater than `now` (the same minute never matches),
 * or `null` if no match within ~1 year (malformed / impossible schedule).
 * This is a DRY-RUN helper — it does not schedule or execute anything.
 *
 * Supports the standard 5-field form: `minute hour day-of-month month day-of-week`
 * with `*`, numbers, lists, ranges, and steps. Day-of-week uses 0=Sunday…6=Saturday.
 * Does NOT support macros (@daily, @hourly) or 6-field form with seconds.
 */
export function wouldFireAt(cronExpr: string, now: Date = new Date()): Date | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${parts.length}: "${cronExpr}"`);
  }
  const [mF, hF, domF, monF, dowF] = parts;
  const minutes = parseCronField(mF, 0, 59);
  const hours = parseCronField(hF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);

  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after `now`

  const maxIter = 366 * 24 * 60; // worst case: scan a full year minute-by-minute
  for (let i = 0; i < maxIter; i++) {
    const mon = d.getMonth() + 1;
    if (!months.has(mon)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    const dom = d.getDate();
    const dow = d.getDay();
    if (!doms.has(dom) || !dows.has(dow)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (minutes.has(d.getMinutes())) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
