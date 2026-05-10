/** @internal Colored terminal output helpers for maw SDK plugins. */

const c = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
};

export const print = {
  /** Section header */
  header: (text: string) => console.log(`\n  ${c.cyan}${text}${c.reset}\n`),

  /** Success line */
  ok: (text: string) => console.log(`  ${c.green}✓${c.reset} ${text}`),

  /** Warning line */
  warn: (text: string) => console.log(`  ${c.yellow}⚠${c.reset} ${text}`),

  /** Error line */
  err: (text: string) => console.log(`  ${c.red}✗${c.reset} ${text}`),

  /** Dim/muted text */
  dim: (text: string) => console.log(`  ${c.dim}${text}${c.reset}`),

  /** Bullet list with colored dots */
  list: (items: string[], dot = "●", color = c.green) => {
    for (const item of items) console.log(`    ${color}${dot}${c.reset} ${item}`);
  },

  /** Key-value pair */
  kv: (key: string, value: string) => console.log(`  ${c.dim}${key}:${c.reset} ${value}`),

  /** Table (simple aligned columns) */
  table: (rows: string[][], header?: string[]) => {
    const allRows = header ? [header, ...rows] : rows;
    const widths = allRows[0].map((_, i) => Math.max(...allRows.map(r => (r[i] || "").length)));
    if (header) {
      console.log("  " + header.map((h, i) => h.padEnd(widths[i])).join("  "));
      console.log("  " + widths.map(w => "─".repeat(w)).join("  "));
    }
    for (const row of rows) {
      console.log("  " + row.map((cell, i) => cell.padEnd(widths[i])).join("  "));
    }
  },

  /** Newline */
  nl: () => console.log(),
};
