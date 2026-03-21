# MAW.JS QUICK REFERENCE

## What It Does
maw.js is a multi-agent workflow orchestration platform that remotely controls tmux sessions over SSH. Unified CLI + web interface for managing distributed AI agent teams (Claude/Codex) with real-time monitoring, fleet configuration, worktree hygiene, and Oracle knowledge base integration.

## Installation
```bash
ghq get Soul-Brews-Studio/maw-js
cd $(ghq root)/github.com/Soul-Brews-Studio/maw-js
bun install && bun link
```

## CLI Commands

### Session & Window
| Command | Description |
|---------|-------------|
| `maw ls` | List all tmux sessions + windows |
| `maw peek [agent]` | Peek terminal output |
| `maw hey <agent> <msg>` | Send message to agent |
| `maw <agent> <msg>` | Shorthand for hey |
| `maw view <agent>` | Interactive tmux attach |

### Agent Lifecycle
| Command | Description |
|---------|-------------|
| `maw wake <oracle>` | Start agent in tmux |
| `maw wake <oracle> --issue N` | Wake with GitHub issue |
| `maw wake <oracle> --new <name>` | Create worktree + wake |
| `maw wake all [--resume]` | Wake entire fleet |
| `maw stop` / `maw sleep` | Stop all fleet |

### Fleet Management
| Command | Description |
|---------|-------------|
| `maw fleet ls` | List configs + running status |
| `maw fleet init` | Scan repos → generate configs |
| `maw fleet validate` | Check for conflicts |
| `maw overview` | War room split-pane view |

### Monitoring
| Command | Description |
|---------|-------------|
| `maw tokens` | Token usage stats |
| `maw log chat [oracle]` | Chat view |
| `maw oracle ls` | Fleet status |
| `maw about <oracle>` | Oracle profile |
| `maw pulse ls` | Task board |

## Configuration (maw.config.json)
```json
{
  "host": "white.local",
  "port": 3456,
  "ghqRoot": "/home/nat/Code/github.com",
  "oracleUrl": "http://localhost:47779",
  "env": { "CLAUDE_CODE_OAUTH_TOKEN": "<token>" },
  "commands": {
    "default": "claude --dangerously-skip-permissions --continue",
    "*-oracle": "claude --dangerously-skip-permissions --continue"
  },
  "sessions": { "nexus": "01-oracles" }
}
```

## Web UI Views
| Route | View |
|-------|------|
| `/#fleet` | Fleet grid (default) |
| `/#office` | Agent room grid |
| `/#orbital` | 3D constellation |
| `/#terminal` | Full xterm |
| `/#chat` | Oracle chat log |
| `/#config` | Config editor |
| `/#worktrees` | Worktree hygiene |

## API Endpoints
| Path | Purpose |
|------|---------|
| `/api/sessions` | Tmux sessions |
| `/api/capture` | Pane content |
| `/api/send` | Send keys |
| `/api/tokens` | Token usage |
| `/api/feed` | Activity feed |
| `/api/oracle/search` | Oracle proxy |
| `/api/config` | Config CRUD |
| `/ws` | WebSocket control |
| `/ws/pty` | PTY terminal |
