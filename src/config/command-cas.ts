import { CONFIG_FILE } from "../core/paths";
import {
  CAS_CONFLICT_EXIT,
  ConfigTransactionError,
  commandCas,
  parseCommandCasRequest,
} from "./transaction";

export async function runCommandCas(argv: string[]): Promise<number> {
  if (argv.join("\0") !== ["config", "command-cas", "--protocol", "1", "--stdin-json"].join("\0")) {
    process.stderr.write("SDA-MCP-E-CAS-INPUT invalid command-cas arguments\n");
    return 64;
  }
  try {
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new ConfigTransactionError("SDA-MCP-E-CAS-INPUT", 64, "CAS request too large");
      chunks.push(value);
    }
    const request = parseCommandCasRequest(Buffer.concat(chunks).toString("utf8"));
    const result = commandCas(CONFIG_FILE, request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.result === "conflict") {
      process.stderr.write("SDA-MCP-E-CAS-CONFLICT command field changed\n");
      return CAS_CONFLICT_EXIT;
    }
    return 0;
  } catch (error) {
    if (error instanceof ConfigTransactionError) {
      process.stderr.write(`${error.code} ${error.message}\n`);
      return error.exitCode;
    }
    process.stderr.write("SDA-MCP-E-CAS-IO command CAS failed\n");
    return 74;
  }
}
