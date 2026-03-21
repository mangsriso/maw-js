# MAW.JS CODE SNIPPETS

## 1. Engine — Delta Broadcasting (engine.ts)
- Per-client content cache: `Map<MawWS, string>`
- Only sends when content actually changed
- 50ms capture interval (20 FPS screen updates)
- Lazy intervals: start on first client, stop when empty

## 2. Feed Tailing (feed-tail.ts)
- Byte-offset polling (reads only new bytes)
- Handles file rotation (detects size regression)
- Lazy init from last 100KB chunk
- Pub/sub with unsubscribe cleanup
- Circular buffer: max 200 events

## 3. Token Usage Analysis (token-index.ts)
- mtime-based incremental indexing
- Real-time rate via `find -mmin` + tail slice (200KB)
- 15s cache TTL for sliding window
- Project aggregation and sorting

## 4. Tmux Wrapper (tmux.ts)
- Shell-quoting `q()`: safe alphanumeric pass-through
- Batch ops with `Promise.allSettled()` (no cascade failures)
- Smart text: multiline → buffer, short → literal
- Staggered Enter (immediate + 500ms + 1s)
- `listAll()` with format string parsing (single call vs N sequential)

## 5. PTY Web Terminal (pty.ts)
- Grouped tmux sessions: `new-session -t parent` (shares windows)
- Multi-viewer broadcast (Set of WS clients per PTY)
- 5s timeout before killing if all viewers detach
- Binary frame streaming

## 6. WebSocket Handlers (handlers.ts)
- Active Claude session detection before sending
- `runAction()` wrapper for ok/error responses
- Restart: Ctrl+C twice (2s + 500ms delays)

## 7. Config Patterns (config.ts)
- Glob matching: `*-oracle`, `codex-*`
- Direnv integration + stale CLAUDECODE cleanup
- `--continue` fallback for fresh worktrees
- Masked env: bullet chars, first 3 visible

## 8. Worktree Scanning (worktrees.ts)
- Classification: active (has tmux), stale (disk only), orphan (prunable)
- Naming: `mainrepo.wt-taskname`
- Task name extraction and window matching

## 9. Feed Parser (lib/feed.ts)
- Format: `TIMESTAMP | ORACLE | HOST | EVENT | PROJECT | SESSION » MSG`
- Icon mapping with activity description
- 60-char truncation
- Active oracle tracking within time window

## 10. Server Heartbeat (server.ts)
- Every 15 min: aggregate events, group by parent oracle
- Token rate calculation for same window
- Number formatting (1B, 1M, 1K)

## 11. JSONL Parsing (maw-log.ts)
- Handles multiline with unescaped quotes
- Multi-pass: parse → repair quotes → retry
- Dedup CLI relay copies, resolve sender from signature
