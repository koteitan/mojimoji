import { subscribeToEvents, unsubscribe } from '../nostr/subscription';
import type { TimelineEvent, Profile } from '../nostr/types';
import type { RelayNode } from '../components/Graph/nodes/RelayNode';
import type { OperatorNode } from '../components/Graph/nodes/OperatorNode';
import type { SearchNode } from '../components/Graph/nodes/SearchNode';
import type { TimelineNode } from '../components/Graph/nodes/TimelineNode';

type NodeTypes = RelayNode | OperatorNode | SearchNode | TimelineNode;

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
  timelineNodeId: string,
  listener: (events: TimelineEvent[]) => void
): void {
  state.eventListeners.set(timelineNodeId, listener);
}

export function unregisterEventListener(timelineNodeId: string): void {
  state.eventListeners.delete(timelineNodeId);
  state.timelineEvents.delete(timelineNodeId);
}

function recalculateSubscriptions(): void {
  // Find all Timeline nodes
  const timelineNodes = Array.from(state.nodes.values()).filter(
    (node) => node.label === 'Timeline'
  ) as TimelineNode[];

  for (const timelineNode of timelineNodes) {
    // Trace back to find the relay
    const relayInfo = traceToRelay(timelineNode.id);

    if (relayInfo) {
      // Start subscription
      const { relayNode, searchNodes } = relayInfo;

      const relayUrls = relayNode.getRelayUrls();
      const filter = relayNode.getFilter();

      subscribeToEvents(
        timelineNode.id,
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
            const events = state.timelineEvents.get(timelineNode.id) || [];
            events.unshift(event);
            // Keep only last 100 events
            if (events.length > 100) {
              events.pop();
            }
            state.timelineEvents.set(timelineNode.id, events);

            // Notify listener
            const listener = state.eventListeners.get(timelineNode.id);
            if (listener) {
              listener([...events]);
            }
          }
        }
      );
    } else {
      // No relay connected, stop subscription
      unsubscribe(timelineNode.id);
    }
  }
}

interface RelayInfo {
  relayNode: RelayNode;
  operatorNodes: OperatorNode[];
  searchNodes: SearchNode[];
}

function traceToRelay(nodeId: string): RelayInfo | null {
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

    if (currentNode.label === 'Relay') {
      return {
        relayNode: currentNode as RelayNode,
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

export function getTimelineEvents(timelineNodeId: string): TimelineEvent[] {
  return state.timelineEvents.get(timelineNodeId) || [];
}

// Profile helper
export function updateEventProfile(
  timelineNodeId: string,
  pubkey: string,
  profile: Profile
): void {
  const events = state.timelineEvents.get(timelineNodeId);
  if (events) {
    let updated = false;
    for (const event of events) {
      if (event.event.pubkey === pubkey && !event.profile) {
        event.profile = profile;
        updated = true;
      }
    }
    if (updated) {
      const listener = state.eventListeners.get(timelineNodeId);
      if (listener) {
        listener([...events]);
      }
    }
  }
}
