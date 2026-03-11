import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FleetStore {
  // Recently active: target → last-busy timestamp
  recentMap: Record<string, number>;
  markBusy: (targets: string[]) => void;
  pruneRecent: () => void;

  // UI preferences
  sortMode: "active" | "name";
  setSortMode: (mode: "active" | "name") => void;
  grouped: boolean;
  toggleGrouped: () => void;
  collapsed: string[];
  toggleCollapsed: (key: string) => void;
}

const RECENT_TTL = 30 * 60 * 1000; // 30 minutes

export const useFleetStore = create<FleetStore>()(
  persist(
    (set, get) => ({
      recentMap: {},
      markBusy: (targets) => set((s) => {
        const now = Date.now();
        const next = { ...s.recentMap };
        let changed = false;
        for (const t of targets) {
          if (next[t] !== now) { next[t] = now; changed = true; }
        }
        return changed ? { recentMap: next } : s;
      }),
      pruneRecent: () => set((s) => {
        const now = Date.now();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(s.recentMap)) {
          if (now - v < RECENT_TTL) next[k] = v;
          else changed = true;
        }
        return changed ? { recentMap: next } : s;
      }),

      sortMode: "active",
      setSortMode: (mode) => set({ sortMode: mode }),
      grouped: true,
      toggleGrouped: () => set((s) => ({ grouped: !s.grouped })),
      collapsed: [],
      toggleCollapsed: (key) => set((s) => ({
        collapsed: s.collapsed.includes(key)
          ? s.collapsed.filter(k => k !== key)
          : [...s.collapsed, key],
      })),
    }),
    {
      name: "maw.fleet",
      partialize: (s) => ({
        recentMap: s.recentMap,
        sortMode: s.sortMode,
        grouped: s.grouped,
        collapsed: s.collapsed,
      }),
    }
  )
);

export const RECENT_TTL_MS = RECENT_TTL;
