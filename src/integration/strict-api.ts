/** Closed, statically linked copy of maw's authoritative direct API graph. */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { sessionsApi } from "../api/sessions";
import { feedApi } from "../api/feed";
import { teamsApi } from "../api/teams";
import { configApi } from "../api/config";
import { fleetApi } from "../api/fleet";
import { asksApi } from "../api/asks";
import { oracleApi } from "../api/oracle";
import { federationApi } from "../api/federation";
import { worktreesApi } from "../api/worktrees";
import { sweeperApi } from "../api/sweeper";
import { uiStateApi } from "../api/ui-state";
import { deprecatedApi } from "../api/deprecated";
import { costsApi } from "../api/costs";
import { triggersApi } from "../api/triggers";
import { avengersApi } from "../api/avengers";
import { transportApi } from "../api/transport";
import { workspaceApi } from "../api/workspace";
import { peerExecApi } from "../api/peer-exec";
import { proxyApi } from "../api/proxy";
import { pulseApi } from "../api/pulse";
import { uploadApi } from "../api/upload";
import { pairApi } from "../api/pair";
import { consentApi } from "../api/consent";
import { claudeFleetApi } from "../api/claude-fleet";
import { peerDiscoveriesApi } from "../api/peers-discoveries";
import { engineApi } from "../api/engine";
import { federationAuth, fromSigningAuth } from "../lib/elysia-auth";

export const strictApi = new Elysia({ prefix: "/api" })
  .use(cors())
  .use(federationAuth)
  .use(fromSigningAuth)
  .onAfterHandle(({ set }) => {
    set.headers["Access-Control-Allow-Private-Network"] = "true";
  })
  .use(swagger({ path: "/docs", documentation: { info: { title: "maw-js API", version: "2.0.0-alpha.1" } } }))
  .use(sessionsApi).use(feedApi).use(teamsApi).use(configApi).use(fleetApi)
  .use(asksApi).use(oracleApi).use(federationApi).use(worktreesApi).use(sweeperApi)
  .use(uiStateApi).use(deprecatedApi).use(costsApi).use(triggersApi).use(avengersApi)
  .use(transportApi).use(workspaceApi).use(peerExecApi).use(proxyApi).use(pulseApi)
  .use(uploadApi)
  .use(pairApi).use(consentApi).use(claudeFleetApi).use(peerDiscoveriesApi).use(engineApi);

export const strictDirectRouteKeys = () => strictApi.routes.map(route => `${route.method}|${route.path}`).sort();
