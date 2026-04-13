import { Elysia } from "elysia";
import { getSweeperStats, sweep } from "../sweeper";
import { feedBuffer } from "./feed";

export const sweeperApi = new Elysia();

/** GET /sweeper — sweeper stats (enabled, config, last sweep, total cleaned) */
sweeperApi.get("/sweeper", () => getSweeperStats());

/** POST /sweeper/run — trigger a manual sweep cycle */
sweeperApi.post("/sweeper/run", async () => {
  const result = await sweep(feedBuffer);
  return result;
});
