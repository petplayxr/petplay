import { useSyncExternalStore } from "react";
import type { LayoutSlotSummary } from "./spatialLayoutPersistence.ts";
import type { SpatialGraph } from "./spatialGraph.ts";

export type WorkspaceLayoutOutput = {
  id: string;
  name: string;
  assignedDisplayId: string | null;
};

export type WorkspaceLayoutDisplay = {
  id: string;
  ordinal: number;
  root: boolean;
  outputId: string | null;
  outputName: string | null;
};

export type WorkspaceLayoutSnapshot = {
  outputs: WorkspaceLayoutOutput[];
  displays: WorkspaceLayoutDisplay[];
  /** Saved layout slots, `null` when empty; index 0 = slot 1. */
  layoutSlots?: (LayoutSlotSummary | null)[];
};

type WorkspaceLayoutActions = {
  assignOutput: (displayId: string, outputId: string) => void;
  addOutput: (outputId: string) => void;
  saveSlot: (slot: number) => void;
  loadSlot: (slot: number) => void;
  getGraph: () => SpatialGraph;
  editGraph: (update: (current: SpatialGraph) => SpatialGraph) => void;
};

let snapshot: WorkspaceLayoutSnapshot = { outputs: [], displays: [] };
let actions: WorkspaceLayoutActions | null = null;
const listeners = new Set<() => void>();

export function publishWorkspaceLayout(next: WorkspaceLayoutSnapshot): void {
  if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function registerWorkspaceLayoutActions(next: WorkspaceLayoutActions): () => void {
  actions = next;
  return () => {
    if (actions === next) actions = null;
  };
}

export function assignWorkspaceLayoutOutput(displayId: string, outputId: string): void {
  actions?.assignOutput(displayId, outputId);
}

export function addWorkspaceLayoutOutput(outputId: string): void {
  actions?.addOutput(outputId);
}

export function saveLayoutSlot(slot: number): void {
  actions?.saveSlot(slot);
}

export function loadLayoutSlot(slot: number): void {
  actions?.loadSlot(slot);
}

export function useWorkspaceLayoutSnapshot(): WorkspaceLayoutSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** The live spatial graph, or null before the scene mounts. For scripts and the REPL. */
export function getSpatialGraph(): SpatialGraph | null {
  return actions?.getGraph() ?? null;
}

/** Apply `update` to the live graph, as a settings click would (it persists the same way). */
export function editSpatialGraph(update: (current: SpatialGraph) => SpatialGraph): boolean {
  if (actions == null) return false;
  actions.editGraph(update);
  return true;
}
