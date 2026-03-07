import { useState, useEffect, useRef, useCallback } from "react";
import { ansiToHtml } from "../lib/ansi";
import type { AgentState } from "../lib/types";

function trimCapture(raw: string): string {
  const lines = raw.split("\n");
  while (lines.length > 0) {
    const stripped = lines[lines.length - 1].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (stripped === "") lines.pop();
    else break;
  }
  return lines.join("\n");
}

interface TerminalModalProps {
  agent: AgentState;
  send: (msg: object) => void;
  onClose: () => void;
  onNavigate: (dir: -1 | 1) => void;
  siblingCount: number;
}

export function TerminalModal({ agent, send, onClose, onNavigate, siblingCount }: TerminalModalProps) {
  const [content, setContent] = useState("");
  const [inputBuf, setInputBuf] = useState("");
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    send({ type: "subscribe", target: agent.target });
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/capture?target=${encodeURIComponent(agent.target)}`);
        const data = await res.json();
        setContent(data.content || "");
      } catch {}
    }, 200);
    return () => { clearInterval(poll); send({ type: "subscribe", target: "" }); };
  }, [agent.target, send]);

  useEffect(() => {
    const el = termRef.current;
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (atBottom) el.scrollTop = el.scrollHeight;
    }
  }, [content]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    // Alt+Arrow to navigate between agents in same room
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); onNavigate(-1); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); onNavigate(1); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputBuf) { send({ type: "send", target: agent.target, text: inputBuf }); setInputBuf(""); }
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) setInputBuf("");
      else setInputBuf((b) => b.slice(0, -1));
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault(); setInputBuf("");
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); setInputBuf((b) => b + e.key);
    }
  }, [inputBuf, agent.target, send, onClose, onNavigate]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (text) setInputBuf((b) => b + text);
  }, []);

  const displayName = agent.name.replace(/-oracle$/, "").replace(/-/g, " ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      tabIndex={0}
      ref={(el) => el?.focus()}
    >
      <div className="w-[90vw] max-w-[900px] h-[80vh] bg-[#0a0a0f] border border-white/[0.06] rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#0e0e18] border-b border-white/[0.06]">
          <div className="flex gap-1.5">
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 cursor-pointer" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>

          {/* Nav arrows */}
          {siblingCount > 1 && (
            <button onClick={() => onNavigate(-1)} className="text-white/25 hover:text-white/60 text-sm cursor-pointer px-1">&larr;</button>
          )}
          <span className="text-xs text-white/60 font-mono font-bold">
            {displayName}
          </span>
          {siblingCount > 1 && (
            <button onClick={() => onNavigate(1)} className="text-white/25 hover:text-white/60 text-sm cursor-pointer px-1">&rarr;</button>
          )}

          <span className="text-[10px] text-white/25 font-mono">
            {agent.target}
          </span>

          <div className="ml-auto flex items-center gap-3">
            {siblingCount > 1 && (
              <span className="text-[9px] text-white/20 tracking-wider">Alt+←→</span>
            )}
            <button onClick={onClose} className="text-white/20 hover:text-white/50 text-lg cursor-pointer">
              &times;
            </button>
          </div>
        </div>

        {/* Terminal output */}
        <div
          ref={termRef}
          className="flex-1 px-4 py-3 overflow-y-auto font-mono text-[13px] leading-[1.35] text-[#aaa] whitespace-pre-wrap break-all bg-[#0a0a0f] saturate-[0.55] brightness-[1.15] contrast-[0.95]"
          dangerouslySetInnerHTML={{ __html: ansiToHtml(trimCapture(content)) }}
        />

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-2 bg-[#0e0e18] border-t border-white/[0.06] font-mono text-xs">
          <span className="text-cyan-400 font-semibold">&#x276f;</span>
          <span className="text-white/90 whitespace-pre">{inputBuf}</span>
          <span className="inline-block w-[7px] h-[15px] bg-cyan-400/80 animate-[blink_1s_step-end_infinite]" />
        </div>
      </div>
    </div>
  );
}
