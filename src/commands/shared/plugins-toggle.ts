/**
 * plugins seam: doEnable + doDisable implementations.
 */

import { discoverPackages, resetDiscoverCache } from "../../plugin/registry";

export function doEnable(name: string): void {
  const { loadConfig, saveConfig } = require("../../config");
  const config = loadConfig();
  const disabled = config.disabledPlugins ?? [];
  if (!disabled.includes(name)) {
    console.log(`${name} is already enabled`);
    return;
  }
  saveConfig({ disabledPlugins: disabled.filter((n: string) => n !== name) });
  resetDiscoverCache();  // config change → next discover call reflects it
  console.log(`\x1b[32m✓\x1b[0m enabled ${name}`);
}

export function doDisable(name: string): void {
  const { loadConfig, saveConfig } = require("../../config");
  const config = loadConfig();
  const disabled = config.disabledPlugins ?? [];
  if (disabled.includes(name)) {
    console.log(`${name} is already disabled`);
    return;
  }
  // Verify plugin exists
  const plugins = discoverPackages();
  if (!plugins.find(p => p.manifest.name === name)) {
    console.error(`plugin not found: ${name}`);
    process.exit(1);
  }
  saveConfig({ disabledPlugins: [...disabled, name] });
  resetDiscoverCache();  // config change → next discover call reflects it
  console.log(`\x1b[33m✗\x1b[0m disabled ${name}`);
}
