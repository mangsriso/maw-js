/**
 * Returns true if stdout appears to support OSC-8 hyperlinks.
 * Conservative heuristic — unknown terminals get plain text.
 *
 * Known supporting: iTerm2, kitty, WezTerm, Alacritty (recent),
 * VSCode integrated (recent), Ghostty, Windows Terminal, Contour.
 * Known NOT supporting: tmux (unless configured), macOS Terminal.app,
 * xterm (classic), non-TTY pipes.
 */
export function supportsHyperlinks(): boolean {
  // Explicit overrides win outright — users may FORCE when piping for verification
  // or NO_HYPERLINKS when a supporting terminal garbles the escapes.
  if (process.env.NO_HYPERLINKS) return false;
  if (process.env.FORCE_HYPERLINKS) return true;

  if (!process.stdout.isTTY) return false;

  // tmux strips OSC-8 unless passthrough is configured. Safe default: no.
  if (process.env.TMUX) return false;

  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram === "iTerm.app") return true;
  if (termProgram === "WezTerm") return true;
  if (termProgram === "vscode") return true;
  if (termProgram === "ghostty") return true;

  const term = process.env.TERM ?? "";
  if (term.startsWith("xterm-kitty")) return true;
  if (term === "alacritty") return true;

  // Windows Terminal
  if (process.env.WT_SESSION) return true;

  return false;
}

/**
 * OSC-8 hyperlink — clickable in supporting terminals, plain text otherwise.
 * Gated by supportsHyperlinks() so unsupported terminals never see raw escapes.
 */
export function tlink(url: string, text?: string): string {
  const label = text ?? url;
  if (!supportsHyperlinks()) return label;
  return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}
