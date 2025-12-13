// Graph data types and constants
// Used by localStorage, Nostr relay storage, and file export/import

// Current graph data version for migration support
// Version history:
//   1: Initial version
//   2: Added visibility field to graph data (moved from Nostr tag)
export const GRAPH_DATA_VERSION = 2;

export type GraphVisibility = 'public' | 'private';

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
  visibility?: GraphVisibility;
}
