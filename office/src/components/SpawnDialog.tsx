import { useState, useEffect } from "react";
import { guessCommand } from "../lib/constants";

interface FleetWindow {
  name: string;
  repo: string;
}

interface FleetConfig {
  name: string;
  windows: FleetWindow[];
  skip_command?: boolean;
}

interface SpawnDialogProps {
  sessions: string[];
  defaultSession: string;
  send: (msg: object) => void;
  onClose: () => void;
}

export function SpawnDialog({ sessions, defaultSession, send, onClose }: SpawnDialogProps) {
  const [configs, setConfigs] = useState<FleetConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/fleet-config")
      .then(r => r.json())
      .then(data => { setConfigs(data.configs || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Flat list of all windows grouped by session
  const presets = configs.flatMap(c =>
    c.windows.map(w => ({ session: c.name, window: w.name, repo: w.repo, skipCmd: c.skip_command }))
  );

  // Find which session config matches defaultSession (the room user clicked "+" on)
  const matchingConfig = configs.find(c => c.name === defaultSession);

  const handleSpawn = (session: string, windowName: string, skipCmd?: boolean) => {
    const cmd = skipCmd ? "" : guessCommand(windowName);
    send({ type: "spawn", session, name: windowName, command: cmd });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 50, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose} />
      <div className="fixed" style={{
        zIndex: 51, left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        width: 420, maxHeight: "70vh", background: "#16161e", borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column",
      }}>
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-base font-bold text-white/90 tracking-wide">Spawn Agent</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 text-lg transition-colors">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-6 py-8 text-center text-white/30 text-sm font-mono">Loading presets...</div>
          )}

          {/* If opened from a specific room, show that room's windows first */}
          {matchingConfig && (
            <div className="border-b border-white/[0.04]">
              <div className="px-6 py-2 text-[10px] font-mono text-white/30 uppercase tracking-[2px]">
                {matchingConfig.name}
              </div>
              {matchingConfig.windows.map(w => (
                <button key={`${matchingConfig.name}:${w.name}`}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/[0.03] transition-colors text-left"
                  onClick={() => handleSpawn(matchingConfig.name, w.name, matchingConfig.skip_command)}>
                  <span className="w-2 h-2 rounded-full bg-emerald-400/60 flex-shrink-0" />
                  <span className="text-[13px] font-mono text-white/80 flex-1 truncate">{w.name}</span>
                  <span className="text-[10px] font-mono text-white/20 truncate max-w-[160px]">{w.repo}</span>
                </button>
              ))}
            </div>
          )}

          {/* All other sessions */}
          {configs.filter(c => c.name !== defaultSession).map(c => (
            <div key={c.name} className="border-b border-white/[0.04]">
              <div className="px-6 py-2 text-[10px] font-mono text-white/30 uppercase tracking-[2px]">
                {c.name}
              </div>
              {c.windows.map(w => (
                <button key={`${c.name}:${w.name}`}
                  className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/[0.03] transition-colors text-left"
                  onClick={() => handleSpawn(c.name, w.name, c.skip_command)}>
                  <span className="w-2 h-2 rounded-full bg-white/20 flex-shrink-0" />
                  <span className="text-[13px] font-mono text-white/80 flex-1 truncate">{w.name}</span>
                  <span className="text-[10px] font-mono text-white/20 truncate max-w-[160px]">{w.repo}</span>
                </button>
              ))}
            </div>
          ))}

          {!loading && configs.length === 0 && (
            <div className="px-6 py-8 text-center text-white/30 text-sm font-mono">
              No fleet configs found in fleet/
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-white/[0.06] text-[9px] font-mono text-white/20">
          Presets from fleet/*.json
        </div>
      </div>
    </>
  );
}
