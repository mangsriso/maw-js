import { Elysia } from "elysia";
import { getSweeperStats, cmdSweep } from "../commands/plugins/sweeper/impl";

export const sweeperApi = new Elysia();

/** GET /sweeper — sweeper stats (enabled, config, last sweep, total cleaned) */
sweeperApi.get("/sweeper", () => getSweeperStats());

/** POST /sweeper/run — trigger a manual sweep cycle */
sweeperApi.post("/sweeper/run", async () => await cmdSweep({ dryRun: false }));
