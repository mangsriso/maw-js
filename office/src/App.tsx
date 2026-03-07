import { useState, useCallback, useMemo } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSessions } from "./hooks/useSessions";
import { UniverseBg } from "./components/UniverseBg";
import { StatusBar } from "./components/StatusBar";
import { RoomGrid } from "./components/RoomGrid";
import { TerminalModal } from "./components/TerminalModal";
import type { AgentState } from "./lib/types";

export function App() {
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null);
  const { sessions, agents, handleMessage } = useSessions();
  const { connected, send } = useWebSocket(handleMessage);

  const onSelectAgent = useCallback((agent: AgentState) => {
    setSelectedAgent(agent);
    send({ type: "select", target: agent.target });
  }, [send]);

  // Agents in the same session as the selected agent
  const siblings = useMemo(() => {
    if (!selectedAgent) return [];
    return agents.filter(a => a.session === selectedAgent.session);
  }, [agents, selectedAgent]);

  const onNavigate = useCallback((dir: -1 | 1) => {
    if (!selectedAgent || siblings.length <= 1) return;
    const idx = siblings.findIndex(a => a.target === selectedAgent.target);
    const next = siblings[(idx + dir + siblings.length) % siblings.length];
    setSelectedAgent(next);
    send({ type: "select", target: next.target });
  }, [selectedAgent, siblings, send]);

  return (
    <div className="relative min-h-screen">
      <UniverseBg />
      <div className="relative z-10">
        <StatusBar connected={connected} agentCount={agents.length} sessionCount={sessions.length} />
        <RoomGrid sessions={sessions} agents={agents} onSelectAgent={onSelectAgent} />
      </div>
      {selectedAgent && (
        <TerminalModal
          agent={selectedAgent}
          send={send}
          onClose={() => setSelectedAgent(null)}
          onNavigate={onNavigate}
          siblingCount={siblings.length}
        />
      )}
    </div>
  );
}
