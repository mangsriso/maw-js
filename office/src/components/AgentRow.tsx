import { memo } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { MiniMonitor } from "./MiniMonitor";
import type { AgentState } from "../lib/types";

interface AgentRowProps {
  agent: AgentState;
  accent: string;
  roomLabel: string;
  saiyan: boolean;
  isLast: boolean;
  agoLabel?: string;
  observe: (el: HTMLElement | null, target: string) => void;
  showPreview: (agent: AgentState, accent: string, label: string, e: React.MouseEvent) => void;
  hidePreview: () => void;
  onAgentClick: (agent: AgentState, accent: string, label: string, e: React.MouseEvent) => void;
}

export const AgentRow = memo(function AgentRow({
  agent,
  accent,
  roomLabel,
  saiyan,
  isLast,
  agoLabel,
  observe,
  showPreview,
  hidePreview,
  onAgentClick,
}: AgentRowProps) {
  const isBusy = agent.status === "busy";
  const displayName = agent.name.replace(/-oracle$/, "").replace(/-/g, " ");

  return (
    <div
      ref={(el) => observe(el, agent.target)}
      className="flex items-center gap-5 px-6 py-3.5 transition-all duration-150 cursor-pointer hover:bg-white/[0.03]"
      style={{
        borderBottom: !isLast ? "1px solid rgba(255,255,255,0.04)" : "none",
        background: isBusy ? `${accent}06` : "transparent",
      }}
      onClick={(e) => onAgentClick(agent, accent, roomLabel, e)}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} - ${agent.status}`}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.preventDefault(); }}
    >
      {/* Avatar */}
      <div
        className="w-14 h-14 flex-shrink-0 cursor-pointer"
        style={{ overflow: "visible" }}
        onMouseEnter={(e) => showPreview(agent, accent, roomLabel, e)}
        onMouseLeave={() => hidePreview()}
      >
        <svg viewBox="-40 -50 80 80" width={56} height={56} overflow="visible">
          <AgentAvatar
            name={agent.name}
            target={agent.target}
            status={agent.status}
            preview={agent.preview}
            accent={accent}
            saiyan={saiyan}
            onClick={() => {}}
          />
        </svg>
      </div>

      {/* Mini monitor */}
      <MiniMonitor
        target={agent.target}
        accent={accent}
        busy={isBusy}
        onMouseEnter={(e) => showPreview(agent, accent, roomLabel, e)}
        onMouseLeave={() => hidePreview()}
        onClick={(e) => onAgentClick(agent, accent, roomLabel, e)}
      />

      {/* Info column */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <span
            className="text-[15px] font-semibold truncate"
            style={{ color: isBusy ? accent : "#E2E8F0" }}
          >
            {displayName}
          </span>
          <span
            className="text-[11px] font-mono px-2.5 py-1 rounded-md flex-shrink-0"
            style={{
              background: isBusy ? "#ffa72620" : agent.status === "ready" ? "#22C55E18" : "rgba(255,255,255,0.06)",
              color: isBusy ? "#ffa726" : agent.status === "ready" ? "#22C55E" : "#94A3B8",
            }}
          >
            {agent.status}
          </span>
          {agoLabel && (
            <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{agoLabel}</span>
          )}
          {saiyan && (
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-md bg-amber-400/20 text-amber-400 flex-shrink-0">
              SAIYAN
            </span>
          )}
        </div>
        <span className="text-[13px] truncate" style={{ color: "#64748B" }}>
          {agent.preview?.slice(0, 80) || "\u00a0"}
        </span>
      </div>
    </div>
  );
});
