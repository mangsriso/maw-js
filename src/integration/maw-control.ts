#!/usr/bin/env bun
/** Standalone protocol-v1 control artifact. No plugin/config cache imports. */

import { runCommandCas } from "../config/command-cas";
import { runDeliveryExec, runDeliveryGuardian, runDeliveryReconcile } from "./delivery";
import { runStrictServer } from "./strict-server";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === "command-cas") {
    return runCommandCas(["config", ...args]);
  }
  if (args[0] === "delivery-exec") return runDeliveryExec(args);
  if (args[0] === "delivery-guardian") return runDeliveryGuardian(args);
  if (args[0] === "delivery-reconcile") return runDeliveryReconcile(args);
  if (args[0] === "strict-server") return runStrictServer(args);
  process.stderr.write("SDA-MCP-E-CAS-INPUT unsupported maw-control operation\n");
  return 64;
}

process.exitCode = await main();
