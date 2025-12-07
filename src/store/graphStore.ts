import { subscribeToEvents, unsubscribe } from '../nostr/subscription';
import type { TimelineEvent, Profile } from '../nostr/types';
import type { SourceNode } from '../components/Graph/nodes/SourceNode';
import type { OperatorNode } from '../components/Graph/nodes/OperatorNode';
import type { SearchNode } from '../components/Graph/nodes/SearchNode';
import type { DisplayNode } from '../components/Graph/nodes/DisplayNode';

type NodeTypes = SourceNode | OperatorNode | SearchNode | DisplayNode;

interface Connection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

interface GraphState {
  nodes: Map<string, NodeTypes>;
  connections: Connection[];
  eventListeners: Map<string, (events: TimelineEvent[]) => void>;
  timelineEvents: Map<string, TimelineEvent[]>;
}

const state: GraphState = {
  nodes: new Map(),
  connections: [],
  eventListeners: new Map(),
  timelineEvents: new Map(),
};

export function registerNode(node: NodeTypes): void {
  state.nodes.set(node.id, node);
}

export function unregisterNode(nodeId: string): void {
  state.nodes.delete(nodeId);
  unsubscribe(nodeId);
}

export function updateConnections(connections: Connection[]): void {
  state.connections = connections;
  recalculateSubscriptions();
}

export function registerEventListener(
  displayNodeId: string,
  listener: (events: TimelineEvent[]) => void
): void {
  state.eventListeners.set(displayNodeId, listener);
}

export function unregisterEventListener(displayNodeId: string): void {
  state.eventListeners.delete(displayNodeId);
  state.timelineEvents.delete(displayNodeId);
}

function recalculateSubscriptions(): void {
  // Find all Display nodes
  const displayNodes = Array.from(state.nodes.values()).filter(
    (node) => node.label === 'Display'
  ) as DisplayNode[];

  for (const displayNode of displayNodes) {
    // Trace back to find the source
    const sourceInfo = traceToSource(displayNode.id);

    if (sourceInfo) {
      // Start subscription
      const { sourceNode, searchNodes } = sourceInfo;

      const relayUrls = sourceNode.getRelayUrls();
      const filter = sourceNode.getFilter();

      subscribeToEvents(
        displayNode.id,
        relayUrls,
        filter,
        (event: TimelineEvent) => {
          // Apply search filters
          let passes = true;
          for (const searchNode of searchNodes) {
            if (!searchNode.matches(event.event.content)) {
              passes = false;
              break;
            }
          }

          if (passes) {
            // Add event to timeline
            const events = state.timelineEvents.get(displayNode.id) || [];
            events.unshift(event);
            // Keep only last 100 events
            if (events.length > 100) {
              events.pop();
            }
            state.timelineEvents.set(displayNode.id, events);

            // Notify listener
            const listener = state.eventListeners.get(displayNode.id);
            if (listener) {
              listener([...events]);
            }
          }
        }
      );
    } else {
      // No source connected, stop subscription
      unsubscribe(displayNode.id);
    }
  }
}

interface SourceInfo {
  sourceNode: SourceNode;
  operatorNodes: OperatorNode[];
  searchNodes: SearchNode[];
}

function traceToSource(nodeId: string): SourceInfo | null {
  const node = state.nodes.get(nodeId);
  if (!node) return null;

  const operatorNodes: OperatorNode[] = [];
  const searchNodes: SearchNode[] = [];

  // Find input connection
  const inputConn = state.connections.find((c) => c.target === nodeId);
  if (!inputConn) return null;

  let currentNodeId = inputConn.source;

  while (currentNodeId) {
    const currentNode = state.nodes.get(currentNodeId);
    if (!currentNode) return null;

    if (currentNode.label === 'Source') {
      return {
        sourceNode: currentNode as SourceNode,
        operatorNodes,
        searchNodes,
      };
    }

    if (currentNode.label === 'Operator') {
      operatorNodes.push(currentNode as OperatorNode);
    }

    if (currentNode.label === 'Search') {
      searchNodes.push(currentNode as SearchNode);
    }

    // Find next input connection
    const nextConn = state.connections.find((c) => c.target === currentNodeId);
    if (!nextConn) return null;

    currentNodeId = nextConn.source;
  }

  return null;
}

export function getTimelineEvents(displayNodeId: string): TimelineEvent[] {
  return state.timelineEvents.get(displayNodeId) || [];
}

// Profile helper
export function updateEventProfile(
  displayNodeId: string,
  pubkey: string,
  profile: Profile
): void {
  const events = state.timelineEvents.get(displayNodeId);
  if (events) {
    let updated = false;
    for (const event of events) {
      if (event.event.pubkey === pubkey && !event.profile) {
        event.profile = profile;
        updated = true;
      }
    }
    if (updated) {
      const listener = state.eventListeners.get(displayNodeId);
      if (listener) {
        listener([...events]);
      }
    }
  }
}
