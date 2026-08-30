#!/usr/bin/env bun
process.env.MAW_CLI = "1";

const args = process.argv.slice(2);

// Keep the protocol-v1 CAS boundary free from ordinary CLI imports. Some of
// those modules load cached config or plugins as import side effects.
if (args[0]?.toLowerCase() === "config" && args[1] === "command-cas") {
  const { runCommandCas } = await import("./config/command-cas");
  process.exitCode = await runCommandCas(args);
} else {
  // Preserve query-string cache busting used by the CLI's isolated harnesses.
  const search = new URL(import.meta.url).search;
  if (search) await import(`./cli-main${search}`);
  else await import("./cli-main");
}
