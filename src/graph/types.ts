// Graph data types and constants
// Used by localStorage, Nostr relay storage, and file export/import

// Current graph data version for migration support
export const GRAPH_DATA_VERSION = 1;

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface GraphData {
  version?: number;
  nodes: unknown[];
  connections: unknown[];
  viewTransform?: ViewTransform;
}
