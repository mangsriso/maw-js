# MAW.JS ARCHITECTURE REPORT

## Executive Summary

**MAW** (Multi-Agent Workflow) is a TypeScript/Bun-based orchestration platform for managing distributed Claude Code agents via tmux. Three primary surfaces:

1. **CLI** (`src/cli.ts`) — Terminal commands for agent orchestration
2. **Server** (`src/server.ts`) — HTTP + WebSocket backend (Hono)
3. **Office** (`office/`) — React 19 SPA with Zustand + real-time WebSocket

Designed as **tmux-native remote control layer** with optional web UI, supporting local and SSH deployments, Oracle v2 integration, and token tracking.

## Directory Structure

```
maw-js/
├── src/                          # Backend (Bun/TypeScript)
│   ├── cli.ts                    # CLI router (shebang executable)
│   ├── server.ts                 # HTTP + WebSocket gateway (Hono)
│   ├── engine.ts                 # Real-time capture + broadcast
│   ├── config.ts                 # Configuration loader
│   ├── tmux.ts                   # Typed tmux CLI wrapper
│   ├── ssh.ts                    # SSH/local execution abstraction
│   ├── pty.ts                    # PTY terminal forwarding
│   ├── hooks.ts                  # Hook registration
│   ├── handlers.ts               # WebSocket message handlers
│   ├── feed-tail.ts              # Real-time ~/.oracle/feed.log tailing
│   ├── token-index.ts            # Claude session token indexing
│   ├── maw-log.ts                # Log entry parsing
│   ├── worktrees.ts              # Git worktree management
│   ├── types.ts                  # Type definitions
│   └── commands/                 # 12 CLI subcommand modules
│       ├── comm.ts               # ls, peek, send
│       ├── wake.ts               # wake agents
│       ├── fleet.ts              # fleet management
│       ├── overview.ts           # war room
│       ├── pulse.ts              # issue + wake orchestration
│       ├── oracle.ts             # fleet status
│       ├── done.ts               # worktree cleanup
│       ├── log.ts                # chat view + export
│       ├── tokens.ts             # usage stats
│       └── completions.ts        # shell completions
├── office/                       # Frontend (React 19 + Vite)
│   └── src/
│       ├── App.tsx               # Hash router
│       ├── components/           # 30+ UI components
│       ├── hooks/                # useWebSocket, useSessions
│       └── lib/                  # store, types, api, feed, sounds
├── package.json                  # Workspaces + dependencies
├── ecosystem.config.cjs          # PM2 config
├── wrangler.json                 # Cloudflare Workers
└── maw.config.example.json       # Example config
```

## Core Modules

### CLI (src/cli.ts)
- Shebang executable, 15+ subcommands
- Session control: ls, peek, hey/send, view
- Agent lifecycle: wake, stop, sleep, done
- Fleet ops: fleet ls/init/validate/renumber/sync
- Orchestration: wake all, overview (war room)

### Server (src/server.ts)
- Hono HTTP + Bun native WebSocket
- Dual HTTP/HTTPS support
- 20+ REST endpoints for sessions, config, tokens, feed, oracle proxy
- Two WS paths: /ws (control) and /ws/pty (terminal)
- Status heartbeat every 15 min

### Engine (src/engine.ts)
- Client lifecycle management
- Capture pipeline: 50ms (main), 2s (previews), 5s (sessions)
- Delta-only broadcasting (content dedup)
- Feed integration via FeedTailer

### Tmux (src/tmux.ts)
- Typed wrapper with SSH-awareness
- Shell-quoting, batch operations
- Smart text sending (multiline → buffer method)

### Config (src/config.ts)
- maw.config.json with glob pattern matching for commands
- Secret masking in API responses
- Direnv integration

## External Dependencies
- hono (HTTP), react 19, zustand (state), three.js (3D), xterm (terminal), monaco-editor
- Runtime: Bun, tmux, SSH, Claude/Codex
- Optional: Oracle v2, PM2, Cloudflare Workers

## Deployment Modes
- Local dev (PM2 + Vite)
- Production (PM2 + built React app)
- Remote SSH
- Cloudflare Workers (frontend only)
