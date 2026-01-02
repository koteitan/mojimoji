import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin } from 'rete-connection-plugin';
import { ConnectionPathPlugin } from 'rete-connection-path-plugin';
import { ReactPlugin, Presets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

import {
  SimpleRelayNode,
  OperatorNode,
  SearchNode,
  LanguageNode,
  NostrFilterNode,
  TimelineNode,
  ConstantNode,
  Nip07Node,
  ExtractionNode,
  ModularRelayNode,
  IfNode,
  CountNode,
  SamplingNode,
  DelayNode,
  FuncDefInNode,
  FuncDefOutNode,
  FunctionNode,
  getCachedProfile,
  getProfileCacheInfo,
} from './nodes';
import type { SocketDefinition } from './nodes';
import type { ConstantType } from './nodes';
import type { ExtractionField, RelayFilterType } from './nodes';
import type { TimelineSignal } from './nodes';
import type { ComparisonOperator } from './nodes';
import type { Filters } from './nodes/controls';
import { CustomNode } from './CustomNode';
import { CustomConnection } from './CustomConnection';
import { CustomSocket } from './CustomSocket';
import { SaveDialog, LoadDialog, PostDialog } from '../Dialogs';
import {
  saveGraph,
  loadGraph,
  saveGraphToPath,
  loadGraphFromPath,
  exportGraphToFile,
  importGraphFromFile,
  GRAPH_DATA_VERSION,
  type GraphData,
} from '../../utils/localStorage';
import { myconsole, onWsConnectionChange } from '../../utils/myconsole';
import { saveGraphToNostr, loadGraphByPath, loadGraphByEventId, loadGraphByNaddr, loadFunctionGraph } from '../../nostr/graphStorage';
import { getPubkey, isNip07Available } from '../../nostr/nip07';
import { SubscriptionTracker } from '../../nostr/SubscriptionTracker';
import { SharedSubscriptionManager } from '../../nostr/SharedSubscriptionManager';
import { extractContentWarning, decodeBech32ToHex, isHex64, naddrDecode, eventIdToNevent, pubkeyToNpub, detectEventReference, normalizePubkeyToHex, normalizeEventIdToHex, type EventSignal, type TimelineItem, type TimelineReactionGroupItem } from '../../nostr/types';
import { EventFetcher } from '../../nostr/EventFetcher';
import { merge, type Observable, type Subscription } from 'rxjs';
import { APP_VERSION } from '../../App';
import { hasWsParam, isWsConnected, connectWs, disconnectWs } from '../../utils/myconsole';
import './GraphEditor.css';

// Format build timestamp based on locale
const formatBuildTimestamp = (): string => {
  const utcDate = new Date(__BUILD_TIMESTAMP_UTC__);
  const isJapanese = navigator.language.startsWith('ja');

  if (isJapanese) {
    // JST (UTC+9)
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstDate = new Date(utcDate.getTime() + jstOffset);
    return jstDate.toISOString().replace('T', ' ').substring(0, 19) + ' JST';
  } else {
    // UTC
    return utcDate.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }
};

const BUILD_TIMESTAMP = formatBuildTimestamp();

type NodeTypes = SimpleRelayNode | OperatorNode | SearchNode | LanguageNode | NostrFilterNode | TimelineNode | ConstantNode | Nip07Node | ExtractionNode | ModularRelayNode | IfNode | CountNode | SamplingNode | DelayNode | FuncDefInNode | FuncDefOutNode | FunctionNode;

// Helper to get the internal node type
const getNodeType = (node: NodeTypes): string => {
  return (node as NodeTypes & { nodeType: string }).nodeType;
};

// Check if adding a connection from sourceId to targetId would create a cycle
// A cycle exists if there's already a path from targetId to sourceId
const wouldCreateCycle = (
  connections: Array<{ source: string; target: string }>,
  sourceId: string,
  targetId: string
): boolean => {
  // If source equals target, it's a self-loop (already prevented elsewhere)
  if (sourceId === targetId) return true;

  // Check if there's a path from targetId to sourceId using DFS
  const visited = new Set<string>();

  const canReach = (current: string, goal: string): boolean => {
    if (current === goal) return true;
    if (visited.has(current)) return false;
    visited.add(current);

    // Follow all outgoing connections from current node
    for (const conn of connections) {
      if (conn.source === current) {
        if (canReach(conn.target, goal)) return true;
      }
    }
    return false;
  };

  // If we can reach sourceId from targetId, adding sourceId -> targetId creates a cycle
  return canReach(targetId, sourceId);
};

// Topological sort of nodes based on connection dependencies
// Returns node IDs in order where each node comes after all its dependencies (source nodes)
const topologicalSort = (
  nodes: Array<{ id: string }>,
  connections: Array<{ source: string; target: string }>
): string[] => {
  // Build adjacency list and in-degree count
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize all nodes
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build graph from connections
  for (const conn of connections) {
    // source -> target means target depends on source
    // Only count if both source and target exist in nodes
    if (inDegree.has(conn.source) && inDegree.has(conn.target)) {
      adjacencyList.get(conn.source)!.push(conn.target);
      inDegree.set(conn.target, (inDegree.get(conn.target) || 0) + 1);
    }
  }

  // Kahn's algorithm: BFS starting from nodes with in-degree 0
  const queue: string[] = [];
  const result: string[] = [];

  // Find all nodes with in-degree 0 (no dependencies)
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    // Reduce in-degree of all neighbors
    for (const neighbor of adjacencyList.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If result doesn't contain all nodes, there's a cycle (shouldn't happen due to cycle detection)
  // Include any remaining nodes at the end
  for (const node of nodes) {
    if (!result.includes(node.id)) {
      result.push(node.id);
    }
  }

  return result;
};

// Helper to check socket compatibility
// Returns true if the two sockets are compatible (same type or Any socket)
const areSocketsCompatible = (
  sourceNode: NodeTypes,
  sourceOutput: string,
  targetNode: NodeTypes,
  targetInput: string
): boolean => {
  // Get output socket from source node
  const output = sourceNode.outputs[sourceOutput];
  if (!output?.socket) return false;

  // Get input socket from target node
  const input = targetNode.inputs[targetInput];
  if (!input?.socket) return false;

  // "Any" socket accepts any type
  if (output.socket.name === 'Any' || input.socket.name === 'Any') {
    return true;
  }

  // Compare socket names (types)
  return output.socket.name === input.socket.name;
};

// Clear socket selection highlight styles
const clearSocketSelection = (container: HTMLElement | null) => {
  if (!container) return;
  container.querySelectorAll('.socket-selected').forEach(el => {
    el.classList.remove('socket-selected');
    const innerSocket = el.querySelector('.custom-socket') as HTMLElement;
    if (innerSocket) {
      innerSocket.style.background = '';
      innerSocket.style.borderColor = '';
      innerSocket.style.boxShadow = '';
    }
  });
};

// Use 'any' to bypass strict Rete.js type constraints
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schemes = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AreaExtra = any;

interface GraphEditorProps {
  onTimelineCreate: (id: string, name: string) => void;
  onTimelineRemove: (id: string) => void;
  onItemsUpdate: (id: string, items: TimelineItem[]) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export function GraphEditor({
  onTimelineCreate,
  onTimelineRemove,
  onItemsUpdate,
  onLoadingChange,
}: GraphEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NodeEditor<Schemes> | null>(null);
  const areaRef = useRef<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const pointerHandlersRef = useRef<{
    down: (e: PointerEvent) => void;
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);
  const touchHandlersRef = useRef<{
    start: (e: TouchEvent) => void;
    move: (e: TouchEvent) => void;
    end: (e: TouchEvent) => void;
  } | null>(null);
  const nodeTouchHandlersRef = useRef<{
    start: (e: TouchEvent) => void;
    move: () => void;
    end: (e: TouchEvent) => void;
  } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectorRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const isLoadingRef = useRef(false);
  const itemsRef = useRef<Map<string, TimelineItem[]>>(new Map());
  // Track item IDs that should be excluded (received 'remove' before 'add')
  const excludedItemsRef = useRef<Map<string, Set<string>>>(new Map());
  const rebuildPipelineRef = useRef<(() => void) | null>(null);
  const loadGraphDataRef = useRef<((graphData: GraphData) => Promise<void>) | null>(null);
  const profileSubscriptionsRef = useRef<Subscription[]>([]);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const pendingConnectionRef = useRef<{ nodeId: string; socketKey: string; side: 'input' | 'output' } | null>(null);

  // State for dropdown menus
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [inputDropdownOpen, setInputDropdownOpen] = useState(false);
  const [functionDropdownOpen, setFunctionDropdownOpen] = useState(false);
  const [editPanelOpen, setEditPanelOpen] = useState(false);
  const inputDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const functionDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inputDropdownOpen && inputDropdownRef.current && !inputDropdownRef.current.contains(event.target as Node)) {
        setInputDropdownOpen(false);
      }
      if (filterDropdownOpen && filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setFilterDropdownOpen(false);
      }
      if (functionDropdownOpen && functionDropdownRef.current && !functionDropdownRef.current.contains(event.target as Node)) {
        setFunctionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inputDropdownOpen, filterDropdownOpen, functionDropdownOpen]);

  // State for save/load/post dialogs
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(isWsConnected());

  // Register callback for WebSocket connection state changes
  useEffect(() => {
    return onWsConnectionChange(setWsConnected);
  }, []);

  // Get the current graph data as GraphData object
  const getCurrentGraphData = useCallback((): GraphData | null => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || isLoadingRef.current) return null;

    const nodes = editor.getNodes().map((node: NodeTypes) => ({
      id: node.id,
      type: (node as NodeTypes & { nodeType: string }).nodeType,
      position: area?.nodeViews.get(node.id)?.position || { x: 0, y: 0 },
      data: 'serialize' in node ? (node as unknown as { serialize: () => unknown }).serialize() : {},
    }));

    const connections = editor.getConnections().map((conn: ClassicPreset.Connection<NodeTypes, NodeTypes>) => ({
      id: conn.id,
      source: conn.source,
      sourceOutput: conn.sourceOutput,
      target: conn.target,
      targetInput: conn.targetInput,
    }));

    // Get current view transform (pan and zoom)
    const viewTransform = area ? {
      x: area.area.transform.x,
      y: area.area.transform.y,
      k: area.area.transform.k,
    } : undefined;

    return { version: GRAPH_DATA_VERSION, nodes, connections, viewTransform };
  }, []);

  const saveCurrentGraph = useCallback(() => {
    const data = getCurrentGraphData();
    if (data) {
      saveGraph(data);
    }
  }, [getCurrentGraphData]);

  // Debug function to dump graph state to console
  const dumpGraph = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      myconsole.log('Editor not initialized');
      return;
    }

    const nodes = editor.getNodes();
    const connections = editor.getConnections();

    const lines: string[] = ['Nodes:'];
    for (const node of nodes) {
      const pos = areaRef.current?.nodeViews.get(node.id)?.position || { x: 0, y: 0 };
      const type = (node as NodeTypes & { nodeType: string }).nodeType;
      lines.push(`  [${type}] ${node.id} (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
    }

    lines.push('', 'Connections:');
    for (const conn of connections) {
      lines.push(`  ${conn.source}.${conn.sourceOutput} -> ${conn.target}.${conn.targetInput}`);
    }
    myconsole.log(lines.join('\n'));
  }, []);

  // Debug function to dump subscription state to console
  // Usage: dumpsub() - show all subscriptions
  //        dumpsub('wss://relay.damus.io') - filter by relay URL
  //        dumpsub(0) - show detail of 0th subscription
  const dumpSub = useCallback((filterOrIndex?: string | number) => {
    const lines: string[] = [];

    // If integer, show detailed view for that subscription
    if (typeof filterOrIndex === 'number') {
      const index = filterOrIndex;
      // Get number of tracker entries first
      const trackerEntries = SubscriptionTracker.getAllStatus();
      const trackerCount = trackerEntries.length;

      if (index < trackerCount) {
        // It's a tracker entry - just show what we have
        const entry = trackerEntries[index];
        if (entry) {
          lines.push(`relay: ${entry.relay}`);
          lines.push(`filter:`);
          lines.push(`  kinds: ${entry.kinds.length > 0 ? entry.kinds.join(', ') : '*'}`);
          lines.push(`status: ${entry.status}`);
        } else {
          lines.push(`Subscription index ${index} not found`);
        }
      } else {
        // It's a shared subscription entry
        const sharedIndex = index - trackerCount;
        const detail = SharedSubscriptionManager.getDetailedEntry(sharedIndex);
        if (detail) {
          lines.push(`relay: ${detail.relay}`);
          detail.filters.forEach((filter, i) => {
            lines.push(`filter${i + 1}:`);
            for (const [key, value] of Object.entries(filter)) {
              if (Array.isArray(value)) {
                lines.push(`  ${key}: ${value.join(', ')}`);
              } else {
                lines.push(`  ${key}: ${value}`);
              }
            }
          });
          lines.push(`status: ${detail.status}`);
        } else {
          lines.push(`Subscription index ${index} not found`);
        }
      }
      myconsole.log(lines.join('\n'));
      return;
    }

    // Otherwise, list all subscriptions (optionally filtered by relay)
    const relayFilter = filterOrIndex;

    // Collect entries from SubscriptionTracker (one-shot operations)
    const trackerEntries = relayFilter
      ? SubscriptionTracker.getStatusForRelay(relayFilter)
      : SubscriptionTracker.getAllStatus();

    // Collect entries from SharedSubscriptionManager (relay nodes)
    const allSharedEntries = SharedSubscriptionManager.getRelayStatusEntries();
    const sharedEntries = relayFilter
      ? allSharedEntries.filter(e => e.relay.includes(relayFilter) || relayFilter.includes(e.relay))
      : allSharedEntries;

    // Combine all entries
    const allEntries = [...trackerEntries, ...sharedEntries.map((e, i) => ({
      index: trackerEntries.length + i + 1,
      ...e,
    }))];

    if (allEntries.length === 0) {
      myconsole.log('No subscriptions');
      return;
    }

    // Calculate column widths for alignment
    const maxIndex = String(allEntries.length).length;
    const maxRelay = Math.max(...allEntries.map(e => e.relay.length));
    const formatKinds = (kinds: number[]) => kinds.length > 0 ? kinds.join(',') : '*';
    const maxKinds = Math.max(...allEntries.map(e => formatKinds(e.kinds).length));
    const maxPurpose = Math.max(...allEntries.map(e => e.purpose.length));

    // Status color mapping
    const getStatusColor = (status: string): string => {
      const baseStatus = status.replace(/ \(completed\)$/, '');
      switch (baseStatus) {
        case 'connected': return '#00ff00';  // green
        case 'connecting': return '#ffff00'; // yellow
        case 'disconnected': return '#ff0000'; // red
        case 'dormant': return '#888888'; // gray
        case 'error': return '#ff0000'; // red
        default: return '#888888'; // gray for unknown
      }
    };

    // Build entries - format: [index]: [relay] -> kind:[kinds] -> [receiver]: [status]
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i];
      const idx = String(i).padStart(maxIndex);
      const relay = entry.relay.padEnd(maxRelay);
      const kinds = `kind:${formatKinds(entry.kinds).padEnd(maxKinds)}`;
      const purpose = entry.purpose.padEnd(maxPurpose);
      const errorSuffix = entry.error ? ` (${entry.error})` : '';

      lines.push(`${idx}: ${relay} -> ${kinds} -> ${purpose}: %c${entry.status}${errorSuffix}%c`);
      lines.push(`color: ${getStatusColor(entry.status)}; font-weight: bold`);
      lines.push('');  // Reset style
    }

    // Output with color styling (need separate myconsole.log for %c to work per line)
    for (let i = 0; i < allEntries.length; i++) {
      const lineIdx = i * 3;
      myconsole.log(lines[lineIdx], lines[lineIdx + 1], lines[lineIdx + 2]);
    }
  }, []);

  // Debug function to dump profile cache info to console
  const infoCache = useCallback(() => {
    const info = getProfileCacheInfo();
    const lines: string[] = ['=== Profile Cache Info ===', ''];
    lines.push(`Items: ${info.count}`);
    lines.push(`Size: ${info.bytes.toLocaleString()} bytes`);
    if (info.bytes >= 1024) {
      lines.push(`      ${(info.bytes / 1024).toFixed(2)} KB`);
    }
    lines.push('==========================');
    myconsole.log(lines.join('\n'));
  }, []);

  // Toggle timeline monitoring
  const monTimeline = useCallback(() => {
    if (SimpleRelayNode.isMonitoring()) {
      SimpleRelayNode.stopMonitoring();
    } else {
      SimpleRelayNode.startMonitoring();
    }
  }, []);

  // Reconnect all relay nodes (for debugging stuck connections)
  const reconnect = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      myconsole.log('Editor not initialized');
      return;
    }
    const nodes = editor.getNodes();
    let count = 0;
    for (const node of nodes) {
      if (getNodeType(node) === 'SimpleRelay') {
        const relayNode = node as SimpleRelayNode;
        relayNode.restartSubscription();
        count++;
      }
    }
    myconsole.log(`Reconnected ${count} relay node(s)`);
  }, []);

  // Clean up completed subscriptions (for debugging)
  const cleanSub = useCallback(() => {
    const removed = SubscriptionTracker.cleanup();
    myconsole.log(`Cleaned up ${removed} completed subscription(s)`);
  }, []);

  // Dump observable stream structure (for debugging)
  // Shows connections including expanded FunctionNode internals
  const dumpObStream = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      myconsole.log('Editor not initialized');
      return;
    }

    const lines: string[] = [];
    const nodes = editor.getNodes();
    const connections = editor.getConnections();

    // Helper to get short node identifier
    const getNodeLabel = (nodeId: string): string => {
      const node = editor.getNode(nodeId);
      if (!node) return nodeId.slice(0, 8);
      const type = getNodeType(node);
      return `${type}:${nodeId.slice(0, 8)}`;
    };

    // Helper to check if a node's output is complete
    const isOutputComplete = (nodeId: string, socketKey: string): boolean => {
      const node = editor.getNode(nodeId);
      if (!node) return false;
      const nodeType = getNodeType(node);

      // Check completion based on node type
      if (nodeType === 'Constant') {
        // ConstantNode completes immediately after emitting
        return (node as ConstantNode).isComplete?.() ?? false;
      } else if (nodeType === 'Nip07') {
        return (node as Nip07Node).isComplete?.() ?? false;
      } else if (nodeType === 'If') {
        return (node as IfNode).isComplete?.() ?? false;
      } else if (nodeType === 'Count') {
        return (node as CountNode).isComplete?.() ?? false;
      } else if (nodeType === 'Extraction') {
        return (node as ExtractionNode).isComplete?.() ?? false;
      } else if (nodeType === 'Function') {
        return (node as FunctionNode).isOutputComplete?.(socketKey) ?? false;
      }
      // ModularRelay, SimpleRelay, Timeline, etc. don't complete
      return false;
    };

    // Helper to get relay node subscription status
    const getRelayStatus = (nodeId: string): string | null => {
      const node = editor.getNode(nodeId);
      if (!node) return null;
      const nodeType = getNodeType(node);

      if (nodeType === 'ModularRelay') {
        return (node as ModularRelayNode).getSubscriptionStatus();
      } else if (nodeType === 'SimpleRelay') {
        return (node as SimpleRelayNode).getSubscriptionStatus();
      }
      return null;
    };

    // Collect all connections with indices
    interface ConnectionEntry {
      sourceLabel: string;
      sourceOutput: string;
      targetLabel: string;
      targetInput: string;
      isComplete: boolean;
      relayStatus: string | null;
    }
    const entries: ConnectionEntry[] = [];

    // Regular connections from editor
    for (const conn of connections) {
      entries.push({
        sourceLabel: getNodeLabel(conn.source),
        sourceOutput: conn.sourceOutput,
        targetLabel: getNodeLabel(conn.target),
        targetInput: conn.targetInput,
        isComplete: isOutputComplete(conn.source, conn.sourceOutput),
        relayStatus: getRelayStatus(conn.source),
      });
    }

    // Calculate max index width
    const maxIndexWidth = String(entries.length).length;

    lines.push('Observable Stream Connections:');
    entries.forEach((entry, index) => {
      const indexStr = String(index).padStart(maxIndexWidth);
      const completeFlag = entry.isComplete ? ' (complete)' : '';
      const relayFlag = entry.relayStatus ? ` (${entry.relayStatus})` : '';
      lines.push(`  ${indexStr}:${entry.sourceLabel}.${entry.sourceOutput} -> ${entry.targetLabel}.${entry.targetInput}${completeFlag}${relayFlag}`);
    });

    // FunctionNode internal connections (expanded)
    lines.push('');
    lines.push('FunctionNode Internal Wiring:');
    let hasFunctionNodes = false;
    for (const node of nodes) {
      if (getNodeType(node) === 'Function') {
        const functionNode = node as FunctionNode;
        const def = functionNode.getFunctionDefinition();
        if (def) {
          hasFunctionNodes = true;
          const nodeLabel = `Function:${node.id.slice(0, 8)}`;
          lines.push(`  [${nodeLabel}] path: ${functionNode.getFunctionPath()}`);

          // Get internal wiring info
          const wiringInfo = functionNode.getInternalWiringInfo();

          // Show internal nodes
          if (wiringInfo.nodes.length > 0) {
            lines.push(`    Internal nodes: ${wiringInfo.nodes.join(', ')}`);
          }

          // Show internal connections with indices
          const internalMaxIndexWidth = String(wiringInfo.connections.length).length;
          wiringInfo.connections.forEach((conn, i) => {
            const indexStr = String(i).padStart(internalMaxIndexWidth);
            lines.push(`    ${indexStr}:${conn}`);
          });
        }
      }
    }
    if (!hasFunctionNodes) {
      lines.push('  (no FunctionNodes)');
    }
    myconsole.log(lines.join('\n'));
  }, []);

  // Dump timeline signals (for debugging)
  // Usage: dumptl() - show all timeline signals
  const dumpTl = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      myconsole.log('Editor not initialized');
      return;
    }

    const lines: string[] = [];
    const nodes = editor.getNodes();
    let timelineIndex = 0;

    for (const node of nodes) {
      if (getNodeType(node) === 'Timeline') {
        const timelineNode = node as TimelineNode;
        const items = itemsRef.current.get(node.id) || [];
        const name = timelineNode.getTimelineName();
        const shortId = node.id.slice(0, 8);

        lines.push(`${timelineIndex}:${name} [${shortId}]`);

        items.forEach((item, signalIndex) => {
          let signalStr: string;
          switch (item.type) {
            case 'event':
              signalStr = eventIdToNevent(item.event.id);
              break;
            case 'eventId':
              signalStr = eventIdToNevent(item.eventId);
              break;
            case 'pubkey':
              signalStr = pubkeyToNpub(item.pubkey);
              break;
            case 'relay':
              signalStr = item.relays.join(', ');
              break;
            case 'datetime':
              signalStr = `datetime:${item.datetime} (${new Date(item.datetime * 1000).toISOString()})`;
              break;
            case 'integer':
              signalStr = `integer:${item.value}`;
              break;
            case 'flag':
              signalStr = `flag:${item.flag}`;
              break;
            case 'relayStatus':
              signalStr = `relayStatus:${item.status}`;
              break;
            case 'complete':
              signalStr = 'complete';
              break;
            default:
              signalStr = `unknown:${JSON.stringify(item)}`;
          }
          lines.push(`  ${signalIndex}:${signalStr}`);
        });

        timelineIndex++;
      }
    }

    if (timelineIndex === 0) {
      lines.push('No timelines found');
    }
    myconsole.log(lines.join('\n'));
  }, []);

  // Dump all: runs dumpgraph, dumpobstream, and dumptl
  const dumpAll = useCallback(() => {
    dumpGraph();
    myconsole.log('');
    dumpObStream();
    myconsole.log('');
    dumpTl();
  }, [dumpGraph, dumpObStream, dumpTl]);

  // Expose debug functions to window
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpgraph = dumpGraph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpsub = dumpSub;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).cleansub = cleanSub;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpobstream = dumpObStream;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumptl = dumpTl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpall = dumpAll;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).infocache = infoCache;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).montimeline = monTimeline;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).reconnect = reconnect;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpgraph;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpsub;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).cleansub;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpobstream;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumptl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpall;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).infocache;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).montimeline;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).reconnect;
    };
  }, [dumpGraph, dumpSub, cleanSub, dumpObStream, dumpTl, dumpAll, infoCache, monTimeline, reconnect]);

  // Find all downstream timeline IDs from a given node
  const findDownstreamTimelines = useCallback((startNodeId: string): Set<string> => {
    const editor = editorRef.current;
    if (!editor) return new Set();

    const connections = editor.getConnections();
    const timelineIds = new Set<string>();
    const visited = new Set<string>();

    const traverse = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = editor.getNode(nodeId);
      if (!node) return;

      if (getNodeType(node) === 'Timeline') {
        timelineIds.add(nodeId);
        return;
      }

      // Find connections where this node is the source
      const outgoingConns = connections.filter(
        (c: { source: string }) => c.source === nodeId
      );

      for (const conn of outgoingConns) {
        traverse(conn.target);
      }
    };

    traverse(startNodeId);
    return timelineIds;
  }, []);

  // Store downstream timelines ref for use in rebuildPipeline
  const timelinesToClearRef = useRef<Set<string> | null>(null);

  // Listen for control changes to save to localStorage and rebuild pipeline
  useEffect(() => {
    const handleControlChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string; rebuildPipeline?: boolean }>;
      const nodeId = customEvent.detail?.nodeId;
      const shouldRebuild = customEvent.detail?.rebuildPipeline !== false;

      saveCurrentGraph();

      // Check if the changed node is a Timeline node and update its name
      if (nodeId) {
        const editor = editorRef.current;
        if (editor) {
          const node = editor.getNode(nodeId);
          if (node && getNodeType(node) === 'Timeline') {
            const timelineNode = node as TimelineNode;
            onTimelineCreate(nodeId, timelineNode.getTimelineName());
          }
        }
      }

      // Skip pipeline rebuild if not needed (e.g., display-only changes like timeline name)
      if (!shouldRebuild) return;

      // Find downstream timelines from the changed node and clear only those
      if (nodeId) {
        timelinesToClearRef.current = findDownstreamTimelines(nodeId);
      } else {
        timelinesToClearRef.current = null; // Clear all if no nodeId
      }

      // Rebuild pipeline to apply new attribute values
      rebuildPipelineRef.current?.();
      timelinesToClearRef.current = null;
    };
    window.addEventListener('graph-control-change', handleControlChange);
    return () => {
      window.removeEventListener('graph-control-change', handleControlChange);
    };
  }, [saveCurrentGraph, findDownstreamTimelines, onTimelineCreate]);

  // Listen for socket changes to update the node visually
  useEffect(() => {
    const handleSocketsChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string }>;
      const nodeId = customEvent.detail?.nodeId;
      const area = areaRef.current;
      if (area && nodeId) {
        area.update('node', nodeId);
      }
    };
    window.addEventListener('graph-sockets-change', handleSocketsChange);
    return () => {
      window.removeEventListener('graph-sockets-change', handleSocketsChange);
    };
  }, []);

  // Get the output Observable from a node by traversing connections
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getNodeOutput = useCallback((nodeId: string, sourceOutput?: string): Observable<any> | null => {
    const editor = editorRef.current;
    if (!editor) return null;

    const node = editor.getNode(nodeId);
    if (!node) return null;

    if (getNodeType(node) === 'SimpleRelay') {
      return (node as SimpleRelayNode).output$;
    } else if (getNodeType(node) === 'ModularRelay') {
      const modularRelayNode = node as ModularRelayNode;
      // Return different output based on sourceOutput
      if (sourceOutput === 'relayStatus') {
        return modularRelayNode.relayStatus$;
      }
      return modularRelayNode.output$;
    } else if (getNodeType(node) === 'Operator') {
      return (node as OperatorNode).output$;
    } else if (getNodeType(node) === 'Search') {
      return (node as SearchNode).output$;
    } else if (getNodeType(node) === 'Language') {
      return (node as LanguageNode).output$;
    } else if (getNodeType(node) === 'NostrFilter') {
      return (node as NostrFilterNode).output$;
    } else if (getNodeType(node) === 'Constant') {
      return (node as ConstantNode).output$;
    } else if (getNodeType(node) === 'Nip07') {
      return (node as Nip07Node).output$;
    } else if (getNodeType(node) === 'Extraction') {
      return (node as ExtractionNode).getOutput$();
    } else if (getNodeType(node) === 'If') {
      return (node as IfNode).output$;
    } else if (getNodeType(node) === 'Count') {
      return (node as CountNode).output$;
    } else if (getNodeType(node) === 'Sampling') {
      return (node as SamplingNode).output$;
    } else if (getNodeType(node) === 'Delay') {
      return (node as DelayNode).output$;
    } else if (getNodeType(node) === 'FuncDefIn') {
      const funcDefInNode = node as FuncDefInNode;
      // sourceOutput is like 'out_0', 'out_1', etc.
      if (sourceOutput) {
        return funcDefInNode.getOutput$(sourceOutput);
      }
      // Default to first output
      return funcDefInNode.getOutputByIndex$(0);
    } else if (getNodeType(node) === 'FuncDefOut') {
      const funcDefOutNode = node as FuncDefOutNode;
      // sourceOutput is like 'in_0', 'in_1', etc.
      if (sourceOutput) {
        return funcDefOutNode.getOutput$(sourceOutput);
      }
      // Default to first output
      return funcDefOutNode.getOutputByIndex$(0);
    } else if (getNodeType(node) === 'Function') {
      const functionNode = node as FunctionNode;
      // sourceOutput is like 'out_0', 'out_1', etc.
      if (sourceOutput) {
        return functionNode.getOutput$(sourceOutput);
      }
      // Default to first output
      return functionNode.getOutputByIndex$(0);
    }

    return null;
  }, []);

  // Rebuild the Observable pipeline for all nodes
  const rebuildPipeline = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const connections = editor.getConnections();
    const nodes = editor.getNodes();

    // Clean up existing profile subscriptions
    for (const sub of profileSubscriptionsRef.current) {
      sub.unsubscribe();
    }
    profileSubscriptionsRef.current = [];

    // First, stop all existing subscriptions
    for (const node of nodes) {
      if (getNodeType(node) === 'SimpleRelay') {
        (node as SimpleRelayNode).stopSubscription();
      } else if (getNodeType(node) === 'Operator') {
        (node as OperatorNode).stopSubscriptions();
      } else if (getNodeType(node) === 'Search') {
        (node as SearchNode).stopSubscription();
      } else if (getNodeType(node) === 'Language') {
        (node as LanguageNode).stopSubscription();
      } else if (getNodeType(node) === 'NostrFilter') {
        (node as NostrFilterNode).stopSubscription();
      } else if (getNodeType(node) === 'Timeline') {
        (node as TimelineNode).stopSubscription();
      } else if (getNodeType(node) === 'Count') {
        (node as CountNode).stopSubscription();
      } else if (getNodeType(node) === 'Sampling') {
        (node as SamplingNode).stopSubscription();
      } else if (getNodeType(node) === 'Delay') {
        (node as DelayNode).stopSubscription();
      } else if (getNodeType(node) === 'If') {
        (node as IfNode).stopSubscriptions();
      } else if (getNodeType(node) === 'FuncDefIn') {
        (node as FuncDefInNode).stopSubscription();
      } else if (getNodeType(node) === 'FuncDefOut') {
        (node as FuncDefOutNode).stopSubscription();
      } else if (getNodeType(node) === 'Function') {
        (node as FunctionNode).stopSubscription();
      }
    }

    // Find which Relay nodes need to be active (connected to a Timeline eventually)
    const activeRelayIds = new Set<string>();
    const findActiveRelays = (nodeId: string, visited: Set<string>) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = editor.getNode(nodeId);
      if (!node) return;

      const nodeType = getNodeType(node);
      if (nodeType === 'SimpleRelay' || nodeType === 'ModularRelay') {
        activeRelayIds.add(nodeId);
        return;
      }

      // Find connections where this node is the target
      const incomingConns = connections.filter(
        (c: { target: string }) => c.target === nodeId
      );

      for (const conn of incomingConns) {
        findActiveRelays(conn.source, visited);
      }
    };

    // Find active relays for each Timeline node
    for (const node of nodes) {
      if (getNodeType(node) === 'Timeline') {
        findActiveRelays(node.id, new Set());
      }
    }

    // Load functions for FunctionNodes that have paths but aren't loaded yet
    const loadFunctionPromises: Promise<void>[] = [];
    for (const node of nodes) {
      if (getNodeType(node) === 'Function') {
        const functionNode = node as FunctionNode;
        const path = functionNode.getFunctionPath();
        const def = functionNode.getFunctionDefinition();
        // Load if path is set but definition is not loaded, path changed, or graphData is empty
        // (deserialize creates a temporary def with empty graphData for socket restoration)
        const graphDataEmpty = !def?.graphData?.nodes?.length;
        if (path && (!def || def.path !== path || graphDataEmpty)) {
          loadFunctionPromises.push(functionNode.loadFunction());
        }
      }
    }
    // Wait for all function loads to complete (async but don't block)
    if (loadFunctionPromises.length > 0) {
      Promise.all(loadFunctionPromises).then(() => {
        // Re-render nodes after loading
        for (const node of nodes) {
          if (getNodeType(node) === 'Function') {
            window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: node.id } }));
          }
        }
      });
    }

    // Start subscriptions on active Relay nodes and subscribe to profile updates
    for (const node of nodes) {
      if (getNodeType(node) === 'SimpleRelay' && activeRelayIds.has(node.id)) {
        const relayNode = node as SimpleRelayNode;
        relayNode.startSubscription();

        // Subscribe to profile updates from this relay
        const profileSub = relayNode.profile$.subscribe({
          next: ({ pubkey, profile }) => {
            // Update all items with this pubkey across all timelines
            for (const [timelineId, items] of itemsRef.current) {
              let updated = false;
              for (const item of items) {
                // Update profile for event items
                if (item.type === 'event' && item.event.pubkey === pubkey && !item.profile) {
                  item.profile = profile;
                  updated = true;
                }
                // Update profile for pubkey items
                if (item.type === 'pubkey' && item.pubkey === pubkey && !item.profile) {
                  item.profile = profile;
                  updated = true;
                }
              }
              if (updated) {
                onItemsUpdate(timelineId, [...items]);
              }
            }
          },
        });
        profileSubscriptionsRef.current.push(profileSub);
      } else if (getNodeType(node) === 'ModularRelay' && activeRelayIds.has(node.id)) {
        // ModularRelay handles its own subscription start via tryStartSubscription
        // when all required inputs (socket values, relay URLs) are received.
        // Don't call startSubscription directly here as it bypasses the socket value check.
      }
    }

    // Helper to get typed output from source node for If inputs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getIfTypedOutput = (sourceId: string, sourceOutput?: string): Observable<any> | null => {
      const sourceNode = editor.getNode(sourceId);
      if (!sourceNode) return null;
      const sourceType = getNodeType(sourceNode);

      // Return the appropriate output based on node type
      if (sourceType === 'Constant') {
        return (sourceNode as ConstantNode).output$;
      } else if (sourceType === 'Nip07') {
        return (sourceNode as Nip07Node).output$;
      } else if (sourceType === 'Extraction') {
        return (sourceNode as ExtractionNode).getOutput$();
      } else if (sourceType === 'If') {
        return (sourceNode as IfNode).output$;
      } else if (sourceType === 'Count') {
        return (sourceNode as CountNode).output$;
      } else if (sourceType === 'ModularRelay') {
        const modularRelayNode = sourceNode as ModularRelayNode;
        if (sourceOutput === 'relayStatus') {
          return modularRelayNode.relayStatus$;
        }
        return null; // Events are not valid for If node
      }
      return null;
    };

    // Topological sort nodes based on connection dependencies
    // This ensures upstream nodes are wired before downstream nodes
    const sortedNodeIds = topologicalSort(nodes, connections);

    // Wire up nodes in topological order
    for (const nodeId of sortedNodeIds) {
      const node = editor.getNode(nodeId);
      if (!node) continue;

      const nodeType = getNodeType(node);

      switch (nodeType) {
        case 'Extraction': {
          const extractionNode = node as ExtractionNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          extractionNode.setInput(input$ as Observable<EventSignal> | null);
          break;
        }

        case 'Operator': {
          const operatorNode = node as OperatorNode;
          const input1Conn = connections.find(
            (c: { target: string; targetInput: string }) =>
              c.target === node.id && c.targetInput === 'input1'
          );
          const input1$ = input1Conn ? getNodeOutput(input1Conn.source) : null;
          const input2Conn = connections.find(
            (c: { target: string; targetInput: string }) =>
              c.target === node.id && c.targetInput === 'input2'
          );
          const input2$ = input2Conn ? getNodeOutput(input2Conn.source) : null;
          operatorNode.setInputs(input1$, input2$);
          break;
        }

        case 'Search': {
          const searchNode = node as SearchNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          searchNode.setInput(input$);
          break;
        }

        case 'Language': {
          const languageNode = node as LanguageNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          languageNode.setInput(input$);
          break;
        }

        case 'NostrFilter': {
          const nostrFilterNode = node as NostrFilterNode;
          // Wire up filter socket inputs first
          const socketKeys = nostrFilterNode.getSocketKeys();
          for (const socketKey of socketKeys) {
            const socketConn = connections.find(
              (c: { target: string; targetInput: string; sourceOutput: string }) =>
                c.target === node.id && c.targetInput === socketKey
            );
            const socket$ = socketConn ? getNodeOutput(socketConn.source, socketConn.sourceOutput) : null;
            nostrFilterNode.setSocketInput(socketKey, socket$);
          }
          // Wire up main event input
          const inputConn = connections.find(
            (c: { target: string; targetInput?: string }) =>
              c.target === node.id && (!c.targetInput || c.targetInput === 'input')
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          nostrFilterNode.setInput(input$);
          break;
        }

        case 'Count': {
          const countNode = node as CountNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          countNode.setInput(input$);
          break;
        }

        case 'If': {
          const ifNode = node as IfNode;
          const inputAConn = connections.find(
            (c: { target: string; targetInput: string; sourceOutput?: string }) =>
              c.target === node.id && c.targetInput === 'inputA'
          ) as { source: string; sourceOutput?: string } | undefined;
          const inputA$ = inputAConn ? getIfTypedOutput(inputAConn.source, inputAConn.sourceOutput) : null;
          ifNode.setInputA(inputA$);
          const inputBConn = connections.find(
            (c: { target: string; targetInput: string; sourceOutput?: string }) =>
              c.target === node.id && c.targetInput === 'inputB'
          ) as { source: string; sourceOutput?: string } | undefined;
          const inputB$ = inputBConn ? getIfTypedOutput(inputBConn.source, inputBConn.sourceOutput) : null;
          ifNode.setInputB(inputB$);
          break;
        }

        case 'ModularRelay': {
          const modularRelayNode = node as ModularRelayNode;
          // Wire up filter socket inputs FIRST (before trigger, so values are ready)
          const socketKeys = modularRelayNode.getSocketKeys();
          for (const socketKey of socketKeys) {
            const socketConn = connections.find(
              (c: { target: string; targetInput: string; sourceOutput: string }) =>
                c.target === node.id && c.targetInput === socketKey
            );
            const socket$ = socketConn ? getNodeOutput(socketConn.source, socketConn.sourceOutput) : null;
            modularRelayNode.setSocketInput(socketKey, socket$);
          }
          // Wire up relay input
          const relayConn = connections.find(
            (c: { target: string; targetInput: string; sourceOutput: string }) =>
              c.target === node.id && c.targetInput === 'relay'
          );
          const relay$ = relayConn ? getNodeOutput(relayConn.source, relayConn.sourceOutput) : null;
          modularRelayNode.setRelayInput(relay$);
          // Wire up trigger input LAST (so all other inputs are ready when subscription starts)
          const triggerConn = connections.find(
            (c: { target: string; targetInput: string; sourceOutput: string }) =>
              c.target === node.id && c.targetInput === 'trigger'
          );
          const trigger$ = triggerConn ? getNodeOutput(triggerConn.source, triggerConn.sourceOutput) : null;
          modularRelayNode.setTriggerInput(trigger$);
          break;
        }

        case 'FuncDefOut': {
          const funcDefOutNode = node as FuncDefOutNode;
          const socketCount = funcDefOutNode.getSocketCount();
          for (let i = 0; i < socketCount; i++) {
            const socketKey = `in_${i}`;
            const inputConn = connections.find(
              (c: { target: string; targetInput: string }) =>
                c.target === node.id && c.targetInput === socketKey
            );
            const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
            funcDefOutNode.setInputByIndex(i, input$);
          }
          break;
        }

        case 'Function': {
          const functionNode = node as FunctionNode;
          const inputKeys = functionNode.getInputKeys();
          for (const inputKey of inputKeys) {
            const inputConn = connections.find(
              (c: { target: string; targetInput: string; sourceOutput: string }) =>
                c.target === node.id && c.targetInput === inputKey
            );
            const input$ = inputConn ? getNodeOutput(inputConn.source, inputConn.sourceOutput) : null;
            functionNode.setInput(inputKey, input$);
          }
          break;
        }

        case 'Sampling': {
          const samplingNode = node as SamplingNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          samplingNode.setInput(input$);
          break;
        }

        case 'Delay': {
          const delayNode = node as DelayNode;
          const inputConn = connections.find(
            (c: { target: string }) => c.target === node.id
          );
          const input$ = inputConn ? getNodeOutput(inputConn.source) : null;
          delayNode.setInput(input$);
          break;
        }

        case 'Timeline': {
          // Timeline wiring is handled separately below due to its complexity
          break;
        }

        // Source nodes (Constant, Nip07, SimpleRelay) don't need input wiring
        // FuncDefIn is also a source node within function definitions
        default:
          break;
      }
    }

    // Wire up Timeline nodes (separate loop due to complexity)
    for (const node of nodes) {
      if (getNodeType(node) === 'Timeline') {
        const timelineNode = node as TimelineNode;
        const timelineNodeId = node.id;

        // Find ALL input connections (multiple sources can connect to the same input)
        const inputConns = connections.filter(
          (c: { target: string; sourceOutput?: string }) => c.target === node.id
        ) as Array<{ source: string; sourceOutput?: string }>;

        // Merge all input observables
        let input$: Observable<unknown> | null = null;
        if (inputConns.length > 0) {
          const observables = inputConns
            .map(conn => getNodeOutput(conn.source, conn.sourceOutput))
            .filter((obs): obs is Observable<unknown> => obs !== null);
          if (observables.length > 0) {
            input$ = observables.length === 1 ? observables[0] : merge(...observables);
          }
        }

        // Clear items only for specified timelines, or all if no specific ones
        const shouldClear = timelinesToClearRef.current === null ||
                           timelinesToClearRef.current.has(timelineNodeId) ||
                           !input$; // Always clear if no input connection
        if (shouldClear) {
          itemsRef.current.set(timelineNodeId, []);
          excludedItemsRef.current.set(timelineNodeId, new Set()); // Also clear excluded set
          onItemsUpdate(timelineNodeId, []);
        }

        // Initialize excluded set for this timeline
        if (!excludedItemsRef.current.has(timelineNodeId)) {
          excludedItemsRef.current.set(timelineNodeId, new Set());
        }
        const excludedSet = excludedItemsRef.current.get(timelineNodeId)!;

        // Helper to generate unique ID for a timeline item (normalized for comparison)
        const generateItemId = (signal: TimelineSignal): string => {
          const data = signal.data;
          switch (signal.type) {
            case 'event':
              // Event ID is already hex - normalize to lowercase
              return (data as EventSignal).event.id.toLowerCase();
            case 'eventId':
              // Normalize note1.../nevent1... to hex for consistent comparison
              return `eventId:${normalizeEventIdToHex(data as string)}`;
            case 'pubkey':
              // Normalize npub1.../nprofile1... to hex for consistent comparison
              return `pubkey:${normalizePubkeyToHex(data as string)}`;
            case 'relay':
              return `relay:${Array.isArray(data) ? (data as string[]).join(',') : data as string}`;
            case 'datetime':
              return `datetime:${data as number}`;
            case 'integer':
              return `integer:${data as number}`;
            case 'flag':
              return `flag:${data as boolean}`;
            case 'relayStatus': {
              // Handle both string (from ConstantNode) and object (from ModularRelayNode)
              if (typeof data === 'string') {
                return `relayStatus:${data}`;
              }
              const statusData = data as { relay: string; status: string };
              return `relayStatus:${statusData.relay}:${statusData.status}`;
            }
            case 'complete':
              return `complete:${Date.now()}`;
            default:
              return `unknown:${Date.now()}`;
          }
        };

        // Helper to convert TimelineSignal to TimelineItem
        const convertToTimelineItem = (signal: TimelineSignal): TimelineItem => {
          const itemId = generateItemId(signal);
          const data = signal.data;

          switch (signal.type) {
            case 'event': {
              const eventSignal = data as EventSignal;
              const cachedProfile = getCachedProfile(eventSignal.event.pubkey);
              const contentWarning = extractContentWarning(eventSignal.event);
              return {
                id: itemId,
                type: 'event',
                event: eventSignal.event,
                profile: cachedProfile,
                contentWarning,
              };
            }
            case 'eventId':
              return { id: itemId, type: 'eventId', eventId: data as string };
            case 'pubkey': {
              const pubkey = data as string;
              const cachedProfile = getCachedProfile(pubkey);
              return { id: itemId, type: 'pubkey', pubkey, profile: cachedProfile };
            }
            case 'relay':
              return { id: itemId, type: 'relay', relays: Array.isArray(data) ? data as string[] : [data as string] };
            case 'datetime':
              return { id: itemId, type: 'datetime', datetime: data as number };
            case 'integer':
              return { id: itemId, type: 'integer', value: data as number };
            case 'flag':
              return { id: itemId, type: 'flag', flag: data as boolean };
            case 'relayStatus': {
              // Handle both string (from ConstantNode) and object (from ModularRelayNode)
              if (typeof data === 'string') {
                return { id: itemId, type: 'relayStatus', status: data };
              }
              const statusData = data as { relay: string; status: string };
              return { id: itemId, type: 'relayStatus', status: `${statusData.relay}: ${statusData.status}` };
            }
            case 'complete':
              return { id: itemId, type: 'complete' };
            default:
              return { id: itemId, type: 'flag', flag: false };
          }
        };

        // Helper to handle reaction grouping
        const handleReactionSignal = (eventSignal: EventSignal) => {
          const reactionEvent = eventSignal.event;
          const reference = detectEventReference(reactionEvent);
          if (!reference || reference.type !== 'reaction') return;

          const targetEventId = reference.eventId;
          const reactionContent = reactionEvent.content || '+';
          const authorPubkey = reactionEvent.pubkey;
          const timestamp = reactionEvent.created_at;
          const authorProfile = getCachedProfile(authorPubkey);

          let items = itemsRef.current.get(timelineNodeId) || [];

          // Find existing reaction group for this target event
          const groupId = `reaction-group-${targetEventId}`;
          let existingGroupIndex = items.findIndex(
            item => item.type === 'reactionGroup' && item.id === groupId
          );

          if (existingGroupIndex >= 0) {
            // Update existing group
            const existingGroup = items[existingGroupIndex] as TimelineReactionGroupItem;

            // Find or create reaction content group
            let contentGroup = existingGroup.reactions.find(r => r.content === reactionContent);
            if (!contentGroup) {
              contentGroup = { content: reactionContent, authors: [] };
              existingGroup.reactions.push(contentGroup);
            }

            // Check if author already exists in this content group
            if (!contentGroup.authors.some(a => a.pubkey === authorPubkey)) {
              contentGroup.authors.push({
                pubkey: authorPubkey,
                profile: authorProfile,
                timestamp,
              });
            }

            // Update newest timestamp for bump-up
            existingGroup.newestTimestamp = Math.max(existingGroup.newestTimestamp, timestamp);

            // Create new items array with updated group
            const updatedItems = [...items];
            updatedItems[existingGroupIndex] = { ...existingGroup };

            // Sort: reaction groups by newestTimestamp, events by created_at
            updatedItems.sort((a, b) => {
              const aTime = a.type === 'reactionGroup' ? a.newestTimestamp :
                           a.type === 'event' ? a.event.created_at : 0;
              const bTime = b.type === 'reactionGroup' ? b.newestTimestamp :
                           b.type === 'event' ? b.event.created_at : 0;
              return bTime - aTime;
            });

            itemsRef.current.set(timelineNodeId, updatedItems);
            onItemsUpdate(timelineNodeId, updatedItems);
          } else {
            // Create new reaction group
            const newGroup: TimelineReactionGroupItem = {
              id: groupId,
              type: 'reactionGroup',
              targetEventId,
              reactions: [{
                content: reactionContent,
                authors: [{
                  pubkey: authorPubkey,
                  profile: authorProfile,
                  timestamp,
                }],
              }],
              newestTimestamp: timestamp,
            };

            // Fetch target event
            EventFetcher.queueRequest(targetEventId, (fetchedEvent) => {
              if (fetchedEvent) {
                // Update the group with fetched event
                const currentItems = itemsRef.current.get(timelineNodeId) || [];
                const groupIdx = currentItems.findIndex(item => item.id === groupId);
                if (groupIdx >= 0) {
                  const group = currentItems[groupIdx] as TimelineReactionGroupItem;
                  group.targetEvent = fetchedEvent;
                  group.targetProfile = getCachedProfile(fetchedEvent.pubkey);
                  const updatedItems = [...currentItems];
                  updatedItems[groupIdx] = { ...group };
                  itemsRef.current.set(timelineNodeId, updatedItems);
                  onItemsUpdate(timelineNodeId, updatedItems);
                }
              }
            });

            // Add new group and sort
            const newItems = [...items, newGroup].sort((a, b) => {
              const aTime = a.type === 'reactionGroup' ? a.newestTimestamp :
                           a.type === 'event' ? a.event.created_at : 0;
              const bTime = b.type === 'reactionGroup' ? b.newestTimestamp :
                           b.type === 'event' ? b.event.created_at : 0;
              return bTime - aTime;
            });

            // Limit to 100 items
            const limitedItems = newItems.slice(0, 100);
            itemsRef.current.set(timelineNodeId, limitedItems);
            onItemsUpdate(timelineNodeId, limitedItems);
          }
        };

        // Set the signal callback - handles both 'add' and 'remove' signals
        timelineNode.setOnTimelineSignal((signal: TimelineSignal) => {
          const items = itemsRef.current.get(timelineNodeId) || [];
          const itemId = generateItemId(signal);

          if (signal.signal === 'add') {
            // Check if this is a reaction event (kind:7)
            if (signal.type === 'event') {
              const eventSignal = signal.data as EventSignal;
              if (eventSignal.event.kind === 7) {
                handleReactionSignal(eventSignal);
                return;
              }
            }

            // Skip if item is in excluded set (remove arrived before add)
            if (excludedSet.has(itemId)) {
              // Remove from excluded set since we've now processed the add
              excludedSet.delete(itemId);
              return;
            }
            // Skip if item already exists (deduplication)
            if (items.some(item => item.id === itemId)) {
              return;
            }
            // Convert signal to timeline item
            const newItem = convertToTimelineItem(signal);
            // Add item (sort by time for event type, otherwise append)
            let newItems: TimelineItem[];
            if (signal.type === 'event') {
              newItems = [...items, newItem].sort((a, b) => {
                const aTime = a.type === 'reactionGroup' ? a.newestTimestamp :
                             a.type === 'event' ? a.event.created_at : 0;
                const bTime = b.type === 'reactionGroup' ? b.newestTimestamp :
                             b.type === 'event' ? b.event.created_at : 0;
                return bTime - aTime;
              });
            } else {
              // For non-event types, prepend (newest first)
              newItems = [newItem, ...items];
            }
            // Limit to 100 items
            const limitedItems = newItems.slice(0, 100);
            itemsRef.current.set(timelineNodeId, limitedItems);
            onItemsUpdate(timelineNodeId, limitedItems);
          } else if (signal.signal === 'remove') {
            // Remove item from timeline
            const filteredItems = items.filter(item => item.id !== itemId);
            // If something was removed
            if (filteredItems.length !== items.length) {
              itemsRef.current.set(timelineNodeId, filteredItems);
              onItemsUpdate(timelineNodeId, filteredItems);
            } else {
              // Item not found - add to excluded set so future 'add' will be ignored
              excludedSet.add(itemId);
            }
          }
        });

        timelineNode.setInput(input$);
      }
    }
  }, [getNodeOutput, onItemsUpdate]);

  // Keep ref updated
  rebuildPipelineRef.current = rebuildPipeline;

  // Load a GraphData into the editor (clears existing nodes/connections first)
  const loadGraphData = useCallback(async (graphData: GraphData) => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;

    isLoadingRef.current = true;

    // Clear all existing nodes and connections
    const existingNodes = editor.getNodes();
    for (const node of existingNodes) {
      // Notify timeline removal
      if (getNodeType(node) === 'Timeline') {
        onTimelineRemove(node.id);
      }
      // Remove connections first
      const connections = editor.getConnections().filter(
        (c: { source: string; target: string }) => c.source === node.id || c.target === node.id
      );
      for (const conn of connections) {
        await editor.removeConnection(conn.id);
      }
      // Remove node
      await editor.removeNode(node.id);
    }

    // Clear items
    itemsRef.current.clear();
    excludedItemsRef.current.clear();

    const nodeMap = new Map<string, NodeTypes>();
    const timelineNodes: Array<{ node: TimelineNode; id: string }> = [];

    // Create nodes
    for (const nodeData of graphData.nodes as Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: unknown;
    }>) {
      let node: NodeTypes;

      switch (nodeData.type) {
        case 'SimpleRelay':
        case 'Relay': // backward compatibility
        case 'Source': // backward compatibility
          node = new SimpleRelayNode();
          if (nodeData.data) {
            (node as SimpleRelayNode).deserialize(nodeData.data as { relayUrls: string[]; filterJson: string });
          }
          break;
        case 'Operator':
          node = new OperatorNode();
          if (nodeData.data) {
            (node as OperatorNode).deserialize(nodeData.data as { operator: 'AND' | 'OR' | 'A-B' });
          }
          break;
        case 'Search':
          node = new SearchNode();
          if (nodeData.data) {
            (node as SearchNode).deserialize(nodeData.data as { keyword: string; useRegex: boolean });
          }
          break;
        case 'Language':
          node = new LanguageNode();
          if (nodeData.data) {
            (node as LanguageNode).deserialize(nodeData.data as { language: string });
          }
          break;
        case 'NostrFilter':
          node = new NostrFilterNode();
          if (nodeData.data) {
            (node as NostrFilterNode).deserialize(nodeData.data as { filterElements: { field: string; value: string }[]; exclude: boolean });
          }
          break;
        case 'Timeline':
        case 'Display': // backward compatibility
          node = new TimelineNode();
          if (nodeData.data) {
            (node as TimelineNode).deserialize(nodeData.data as Record<string, unknown>);
          }
          // Delay onTimelineCreate until after ID is overridden
          timelineNodes.push({ node: node as TimelineNode, id: nodeData.id });
          break;
        case 'Constant':
          node = new ConstantNode();
          if (nodeData.data) {
            (node as ConstantNode).deserialize(nodeData.data as { constantType: ConstantType; rawValue: string });
          }
          break;
        case 'Nip07':
          node = new Nip07Node();
          if (nodeData.data) {
            (node as Nip07Node).deserialize(nodeData.data as Record<string, unknown>);
          }
          break;
        case 'Extraction':
          node = new ExtractionNode();
          if (nodeData.data) {
            (node as ExtractionNode).deserialize(nodeData.data as { extractionField: ExtractionField; relayFilterType: RelayFilterType });
          }
          break;
        case 'ModularRelay':
        case 'MultiTypeRelay': // backward compatibility
          node = new ModularRelayNode();
          if (nodeData.data) {
            // Check for backward compatibility: if there's a trigger connection but no externalTrigger field
            const data = nodeData.data as { filters?: Filters; externalTrigger?: boolean };
            const savedConnections = graphData.connections as Array<{ target: string; targetInput: string }>;

            if (data.externalTrigger === undefined) {
              // Check if there's a trigger connection to this node
              const hasTriggerConnection = savedConnections.some(
                (c) => c.target === nodeData.id && c.targetInput === 'trigger'
              );
              if (hasTriggerConnection) {
                data.externalTrigger = true;
              }
            }

            // Backward compatibility: convert UI fields to socket fields if there are socket connections
            if (data.filters) {
              const socketConnections = savedConnections.filter(
                (c) => c.target === nodeData.id && /^f\d+_e\d+$/.test(c.targetInput)
              );
              for (const conn of socketConnections) {
                const match = conn.targetInput.match(/^f(\d+)_e(\d+)$/);
                if (match) {
                  const filterIndex = parseInt(match[1], 10);
                  const elementIndex = parseInt(match[2], 10);
                  if (data.filters[filterIndex] && data.filters[filterIndex][elementIndex]) {
                    const element = data.filters[filterIndex][elementIndex];
                    // Convert to socket field if not already
                    if (!element.field.endsWith(' (socket)')) {
                      element.field = element.field + ' (socket)';
                    }
                  }
                }
              }
            }

            (node as ModularRelayNode).deserialize(data);
          }
          break;
        case 'If':
          node = new IfNode();
          if (nodeData.data) {
            (node as IfNode).deserialize(nodeData.data as { comparisonType: 'integer' | 'datetime'; operator: ComparisonOperator });
          }
          break;
        case 'Count':
          node = new CountNode();
          if (nodeData.data) {
            (node as CountNode).deserialize(nodeData.data as { count?: number });
          }
          break;
        case 'Sampling':
          node = new SamplingNode();
          if (nodeData.data) {
            (node as SamplingNode).deserialize(nodeData.data as { numerator?: number; denominator?: number });
          }
          break;
        case 'Delay':
          node = new DelayNode();
          if (nodeData.data) {
            (node as DelayNode).deserialize(nodeData.data as { delayValue?: number; delayUnit?: 'ms' | 'sec' | 'min' });
          }
          break;
        case 'FuncDefIn':
          node = new FuncDefInNode();
          if (nodeData.data) {
            (node as FuncDefInNode).deserialize(nodeData.data as { socketList: SocketDefinition[] });
          }
          break;
        case 'FuncDefOut':
          node = new FuncDefOutNode();
          if (nodeData.data) {
            (node as FuncDefOutNode).deserialize(nodeData.data as { socketList: SocketDefinition[] });
          }
          break;
        case 'Function':
          node = new FunctionNode();
          // Set up function loading callback
          (node as FunctionNode).setLoadFunctionCallback(async (path: string) => {
            const userPubkey = isNip07Available() ? await getPubkey() : undefined;
            const result = await loadFunctionGraph(path, userPubkey);
            if (!result) return null;
            return {
              path: result.path,
              pubkey: result.pubkey,
              graphData: result.graphData,
              inputSockets: result.inputSockets,
              outputSockets: result.outputSockets,
            };
          });
          if (nodeData.data) {
            (node as FunctionNode).deserialize(nodeData.data as { functionPath: string; inputSockets?: SocketDefinition[]; outputSockets?: SocketDefinition[] });
          }
          break;
        default:
          continue;
      }

      // Override the auto-generated ID with the saved ID
      (node as unknown as { id: string }).id = nodeData.id;
      await editor.addNode(node);
      await area.translate(node.id, nodeData.position);
      nodeMap.set(nodeData.id, node);
    }

    // Now create timelines for Timeline nodes with correct IDs
    for (const { node, id } of timelineNodes) {
      onTimelineCreate(id, node.getTimelineName());
    }

    // Create connections (they may be displaced initially, will be fixed after view restore)
    const addedConnections: Array<{ source: string; target: string }> = [];
    for (const connData of graphData.connections as Array<{
      id: string;
      source: string;
      sourceOutput: string;
      target: string;
      targetInput: string;
    }>) {
      const sourceNode = nodeMap.get(connData.source);
      const targetNode = nodeMap.get(connData.target);

      if (sourceNode && targetNode) {
        if (wouldCreateCycle(addedConnections, connData.source, connData.target)) {
          console.warn(`[loadGraphData] Skipping cyclic connection: ${connData.source} -> ${connData.target}`);
          continue;
        }
        // Check if source output and target input exist
        if (!sourceNode.outputs[connData.sourceOutput]) {
          console.warn(`[loadGraphData] Skipping connection: source node doesn't have output "${connData.sourceOutput}"`);
          continue;
        }
        if (!targetNode.inputs[connData.targetInput]) {
          console.warn(`[loadGraphData] Skipping connection: target node doesn't have input "${connData.targetInput}"`);
          continue;
        }
        const conn = new ClassicPreset.Connection(
          sourceNode,
          connData.sourceOutput as never,
          targetNode,
          connData.targetInput as never
        );
        await editor.addConnection(conn);
        addedConnections.push({ source: connData.source, target: connData.target });
      }
    }

    isLoadingRef.current = false;

    // Restore view transform if available, otherwise fit view to show all nodes
    setTimeout(async () => {
      if (graphData.viewTransform) {
        area.area.zoom(graphData.viewTransform.k, 0, 0);
        area.area.translate(graphData.viewTransform.x, graphData.viewTransform.y);
      } else {
        await AreaExtensions.zoomAt(area, editor.getNodes());
        const { x, y } = area.area.transform;
        area.area.translate(x, y + 30);
      }

      // Rebuild pipeline after graph is loaded
      rebuildPipelineRef.current?.();
    }, 150);


    // Save to auto-save slot
    saveCurrentGraph();
  }, [onTimelineCreate, onTimelineRemove, saveCurrentGraph]);

  // Store loadGraphData in ref for use in useEffect
  loadGraphDataRef.current = loadGraphData;

  // Handle save dialog save action
  // Returns event ID for Nostr saves (for sharing)
  const handleSave = useCallback(async (
    destination: 'local' | 'nostr' | 'file',
    path: string,
    options?: { visibility?: 'public' | 'private'; relayUrls?: string[] }
  ): Promise<string | void> => {
    const graphData = getCurrentGraphData();
    if (!graphData) return;

    if (destination === 'local') {
      saveGraphToPath(path, graphData);
    } else if (destination === 'file') {
      exportGraphToFile(graphData, path);
    } else if (destination === 'nostr') {
      const eventId = await saveGraphToNostr(path, graphData, {
        visibility: options?.visibility || 'private',
        relayUrls: options?.relayUrls,
      });
      return eventId;
    }
  }, [getCurrentGraphData]);

  // Handle load dialog load action
  const handleLoad = useCallback(async (
    source: 'local' | 'nostr' | 'file',
    pathOrFile: string | File,
    options?: { pubkey?: string }
  ) => {
    let graphData: GraphData | null = null;

    if (source === 'local' && typeof pathOrFile === 'string') {
      graphData = loadGraphFromPath(pathOrFile);
    } else if (source === 'file' && pathOrFile instanceof File) {
      try {
        const result = await importGraphFromFile(pathOrFile);
        graphData = result.data;
      } catch (e) {
        console.error('Failed to import graph from file:', e);
      }
    } else if (source === 'nostr' && typeof pathOrFile === 'string' && options?.pubkey) {
      graphData = await loadGraphByPath(pathOrFile, options.pubkey);
    }

    if (graphData) {
      await loadGraphData(graphData);
    }
  }, [loadGraphData]);

  const addNode = useCallback(async (type: 'SimpleRelay' | 'Operator' | 'Search' | 'Language' | 'NostrFilter' | 'Timeline' | 'Constant' | 'Nip07' | 'Extraction' | 'ModularRelay' | 'If' | 'Count' | 'Sampling' | 'Delay' | 'FuncDefIn' | 'FuncDefOut' | 'Function') => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;

    let node: NodeTypes;

    switch (type) {
      case 'SimpleRelay':
        node = new SimpleRelayNode();
        break;
      case 'Operator':
        node = new OperatorNode();
        break;
      case 'Search':
        node = new SearchNode();
        break;
      case 'Language':
        node = new LanguageNode();
        break;
      case 'NostrFilter':
        node = new NostrFilterNode();
        break;
      case 'Timeline':
        node = new TimelineNode();
        onTimelineCreate(node.id, (node as TimelineNode).getTimelineName());
        break;
      case 'Constant':
        node = new ConstantNode();
        break;
      case 'Nip07':
        node = new Nip07Node();
        break;
      case 'Extraction':
        node = new ExtractionNode();
        break;
      case 'ModularRelay':
        node = new ModularRelayNode();
        break;
      case 'If':
        node = new IfNode();
        break;
      case 'Count':
        node = new CountNode();
        break;
      case 'Sampling':
        node = new SamplingNode();
        break;
      case 'Delay':
        node = new DelayNode();
        break;
      case 'FuncDefIn':
        node = new FuncDefInNode();
        break;
      case 'FuncDefOut':
        node = new FuncDefOutNode();
        break;
      case 'Function':
        node = new FunctionNode();
        // Set up function loading callback
        (node as FunctionNode).setLoadFunctionCallback(async (path: string) => {
          const userPubkey = isNip07Available() ? await getPubkey() : undefined;
          const result = await loadFunctionGraph(path, userPubkey);
          if (!result) return null;
          return {
            path: result.path,
            pubkey: result.pubkey,
            graphData: result.graphData,
            inputSockets: result.inputSockets,
            outputSockets: result.outputSockets,
          };
        });
        break;
      default:
        return;
    }

    await editor.addNode(node);

    // Calculate position based on existing nodes
    const existingNodes = editor.getNodes();
    let newX = 100;
    let newY = 100;
    const nodeSpacing = 50;

    if (existingNodes.length > 1) { // More than just the new node
      // Get positions of all existing nodes (excluding the newly added one)
      const positions: { x: number; y: number; width: number; height: number }[] = [];
      for (const n of existingNodes) {
        if (n.id !== node.id) {
          const view = area.nodeViews.get(n.id);
          if (view) {
            positions.push({
              x: view.position.x,
              y: view.position.y,
              width: n.width || 180,
              height: n.height || 120,
            });
          }
        }
      }

      if (positions.length > 0) {
        // Find bounds
        const minY = Math.min(...positions.map(p => p.y));
        const maxX = Math.max(...positions.map(p => p.x + p.width));
        const maxY = Math.max(...positions.map(p => p.y + p.height));

        if (type === 'SimpleRelay') {
          // Relay nodes: same Y as uppermost, right of rightmost
          newX = maxX + nodeSpacing;
          newY = minY;
        } else {
          // Other nodes: same X as rightmost, below lowermost
          newX = Math.max(...positions.map(p => p.x));
          newY = maxY + nodeSpacing;
        }
      }
    }

    await area.translate(node.id, { x: newX, y: newY });

    // Center view on new node without changing zoom
    const container = area.container;
    const { k } = area.area.transform;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;
    const nodeWidth = node.width || 180;
    const nodeHeight = node.height || 120;

    // Calculate translation to center the node
    const targetX = centerX - (newX + nodeWidth / 2) * k;
    const targetY = centerY - (newY + nodeHeight / 2) * k;

    area.area.translate(targetX, targetY);

    saveCurrentGraph();
  }, [onTimelineCreate, saveCurrentGraph]);

  const centerView = useCallback(async () => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;

    const nodes = editor.getNodes();
    if (nodes.length > 0) {
      await AreaExtensions.zoomAt(area, nodes);
      // Adjust for toolbar height (move view down)
      const { x, y } = area.area.transform;
      area.area.translate(x, y + 30);
    }
  }, []);

  const deleteSelected = useCallback(async () => {
    const editor = editorRef.current;
    const selector = selectorRef.current;
    const container = containerRef.current;
    if (!editor) return;

    // First, check if there's a selected connection to delete
    if (selectedConnectionIdRef.current) {
      await editor.removeConnection(selectedConnectionIdRef.current);
      selectedConnectionIdRef.current = null;
      pendingConnectionRef.current = null;
      // Clear socket selection highlight
      clearSocketSelection(container);
      return;
    }

    // Otherwise, delete selected nodes
    if (!selector) return;

    // Get selected node IDs
    const selected: string[] = [];
    selector.entities.forEach((_value: unknown, id: string) => {
      selected.push(id);
    });

    // Collect nodes to delete and add flash animation
    const nodesToDelete: { id: string; nodeId: string; element: HTMLElement | null }[] = [];
    for (const id of selected) {
      const nodeId = id.startsWith('node_') ? id.slice(5) : id;
      const node = editor.getNode(nodeId);
      if (node) {
        const nodeElement = container?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
        if (nodeElement) {
          nodeElement.classList.add('deleting');
        }
        nodesToDelete.push({ id, nodeId, element: nodeElement });
      }
    }

    // Wait for flash animation to complete (300ms)
    if (nodesToDelete.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Now actually delete the nodes
    for (const { id, nodeId } of nodesToDelete) {
      const node = editor.getNode(nodeId);
      if (node) {
        // Remove connections first
        const connections = editor.getConnections().filter(
          (c: { source: string; target: string }) => c.source === nodeId || c.target === nodeId
        );
        for (const conn of connections) {
          await editor.removeConnection(conn.id);
        }
        // Remove node
        await editor.removeNode(nodeId);
        // Clear from selector
        selector.remove({ id, label: 'node' });
      }
    }
  }, []);

  // Clear all nodes and connections
  const clearAll = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    // Confirm before clearing
    if (!confirm(t('toolbar.confirmClear', 'Clear all nodes and connections?'))) return;

    const existingNodes = editor.getNodes();
    for (const node of existingNodes) {
      // Notify timeline removal
      if (getNodeType(node) === 'Timeline') {
        onTimelineRemove(node.id);
      }
      // Remove connections first
      const connections = editor.getConnections().filter(
        (c: { source: string; target: string }) => c.source === node.id || c.target === node.id
      );
      for (const conn of connections) {
        await editor.removeConnection(conn.id);
      }
      // Remove node
      await editor.removeNode(node.id);
    }

    // Clear items
    itemsRef.current.clear();
    excludedItemsRef.current.clear();
  }, [onTimelineRemove, t]);

  useEffect(() => {
    if (!containerRef.current) return;
    // Prevent double initialization in React StrictMode
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const container = containerRef.current;

    const initEditor = async () => {
      const editor = new NodeEditor<Schemes>();
      editorRef.current = editor;

      const area = new AreaPlugin<Schemes, AreaExtra>(container);
      areaRef.current = area;

      const connection = new ConnectionPlugin<Schemes, AreaExtra>();
      const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });

      // Don't use classic preset - we implement custom drag-to-connect


      // Set up render presets with custom node, connection, and socket
      render.addPreset(
        Presets.classic.setup({
          customize: {
            node() {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return CustomNode as any;
            },
            connection() {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return CustomConnection as any;
            },
            socket() {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return CustomSocket as any;
            },
          },
        })
      );

      editor.use(area);
      area.use(connection);
      area.use(render);

      // Validate connections before they are created (socket type compatibility + cycle detection)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.addPipe((context: any) => {
        if (context.type === 'connectioncreate') {
          const { data } = context;
          const sourceNode = editor.getNode(data.source);
          const targetNode = editor.getNode(data.target);

          if (!sourceNode || !targetNode) return context;

          // Check socket compatibility
          if (!areSocketsCompatible(
            sourceNode as NodeTypes,
            data.sourceOutput,
            targetNode as NodeTypes,
            data.targetInput
          )) {
            console.log('[Connection] Blocked: incompatible socket types');
            return; // Block connection
          }

          // Check for cycles
          const existingConnections = editor.getConnections().map(c => ({
            source: c.source,
            target: c.target,
          }));
          if (wouldCreateCycle(existingConnections, data.source, data.target)) {
            console.log('[Connection] Blocked: would create cycle');
            return; // Block connection
          }

          // Check for duplicate connections
          const isDuplicate = editor.getConnections().some(c =>
            c.source === data.source &&
            c.sourceOutput === data.sourceOutput &&
            c.target === data.target &&
            c.targetInput === data.targetInput
          );
          if (isDuplicate) {
            console.log('[Connection] Blocked: duplicate connection');
            return; // Block connection
          }
        }
        return context;
      });

      // Configure connection path for vertical flow (top to bottom)
      // Custom transformer that creates orthogonal (Cartesian) paths
      // Also corrects for horizontal offset applied by classic preset
      const verticalTransformer = () => (points: { x: number; y: number }[]) => {
        if (points.length !== 2) throw new Error('need 2 points');
        const [start, end] = points;

        // Remove horizontal offset by moving start left and end right
        // The classic preset adds ~12px offset (output right, input left)
        const horizontalCorrection = 12;
        const correctedStart = { x: start.x - horizontalCorrection, y: start.y };
        const correctedEnd = { x: end.x + horizontalCorrection, y: end.y };

        // Create orthogonal path with vertical segments at both ends
        // Add vertical offset so pipes go straight down/up before turning
        const verticalOffset = 40;
        const midY = (correctedStart.y + correctedEnd.y) / 2;

        // Ensure the horizontal segment is between the vertical offsets
        const horizontalY = Math.max(correctedStart.y + verticalOffset, Math.min(correctedEnd.y - verticalOffset, midY));
        const corner1 = { x: correctedStart.x, y: horizontalY };
        const corner2 = { x: correctedEnd.x, y: horizontalY };

        // Return 4 points - use corners as control points to create sharp turns
        return [correctedStart, corner1, corner2, correctedEnd];
      };

      const pathPlugin = new ConnectionPathPlugin<Schemes, AreaExtra>({
        transformer: verticalTransformer,
      });
      render.use(pathPlugin);

      // Helper to update background dot pattern based on transform
      const updateBackground = () => {
        const { k, x, y } = area.area.transform;
        const baseSpacing = 20;
        const spacing = baseSpacing * k;
        container.style.setProperty('--dot-spacing', `${spacing}px`);
        container.style.setProperty('--bg-offset-x', `${x % spacing}px`);
        container.style.setProperty('--bg-offset-y', `${y % spacing}px`);
      };

      // Listen to area transform changes to update background
      area.addPipe((context) => {
        if (context.type === 'zoomed' || context.type === 'translated') {
          updateBackground();
        }
        return context;
      });

      // Set initial background
      updateBackground();

      // Override Rete.js inline touchAction for mobile
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile) {
        // Force touchAction override and watch for changes
        const forceTouchAction = (element: HTMLElement) => {
          if (element.style.touchAction !== 'manipulation') {
            element.style.touchAction = 'manipulation';
          }
        };

        forceTouchAction(container);

        // Watch for Rete.js setting touchAction back to none
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
              const target = mutation.target as HTMLElement;
              if (target.style.touchAction === 'none') {
                target.style.touchAction = 'manipulation';
              }
            }
          }
        });

        observer.observe(container, { attributes: true, attributeFilter: ['style'], subtree: true });

        // Also set on any child divs that might be content holders
        const childDivs = container.querySelectorAll('div');
        childDivs.forEach((div) => {
          if (div instanceof HTMLElement) {
            forceTouchAction(div);
          }
        });
      }

      // Add wheel zoom handler
      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const { k, x, y } = area.area.transform;
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const newZoom = Math.max(0.1, Math.min(2.0, k * delta));
        // Calculate new position to keep mouse point fixed
        const newX = mouseX - (mouseX - x) * (newZoom / k);
        const newY = mouseY - (mouseY - y) * (newZoom / k);

        area.area.zoom(newZoom, 0, 0);
        area.area.translate(newX, newY);
        updateBackground();
      };
      wheelHandlerRef.current = handleWheel;
      container.addEventListener('wheel', handleWheel, { passive: false });

      // Add drag pan handler for background
      let isDragging = false;
      let lastX = 0;
      let lastY = 0;

      const handlePointerDown = (e: PointerEvent) => {
        // On touch devices, don't interfere - let Rete.js and browser handle everything
        if (e.pointerType === 'touch') {
          return;
        }

        // Only pan if clicking on the container background (not on nodes)
        const target = e.target as HTMLElement;
        const isNode = target.closest('.node') || target.closest('.custom-node');
        const isConnection = target.closest('.connection');
        // Check for socket - including styled-components sockets in our custom containers
        const isSocket = target.closest('.socket') ||
                         target.closest('.custom-node-input') ||
                         target.closest('.custom-node-output');
        // Check if clicking on an input element
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        // Blur any focused input when clicking on background or non-input elements
        if (!isInput && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        // Don't start panning if clicking on a node, connection, or socket
        if (!isNode && !isConnection && !isSocket) {
          isDragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
          container.setPointerCapture(e.pointerId);
          e.preventDefault();

          // Unselect all nodes when clicking on background
          if (selectorRef.current) {
            selectorRef.current.unselectAll();
          }
        }
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        const { x, y } = area.area.transform;
        area.area.translate(x + dx, y + dy);
        updateBackground();
      };

      const handlePointerUp = (e: PointerEvent) => {
        if (isDragging) {
          isDragging = false;
          container.releasePointerCapture(e.pointerId);
        }
      };

      pointerHandlersRef.current = {
        down: handlePointerDown,
        move: handlePointerMove,
        up: handlePointerUp,
      };
      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerup', handlePointerUp);

      // Add pinch zoom and 2-finger pan handler for touch devices
      let initialPinchDistance = 0;
      let initialZoom = 1;
      let lastTouchCenterX = 0;
      let lastTouchCenterY = 0;
      let isTwoFingerTouch = false;

      const getDistance = (touches: TouchList) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const getTouchCenter = (touches: TouchList) => {
        return {
          x: (touches[0].clientX + touches[1].clientX) / 2,
          y: (touches[0].clientY + touches[1].clientY) / 2,
        };
      };

      const handleTouchStart = (e: TouchEvent) => {
        // Only handle 2-finger touch, let 1-finger through for parent scroll
        if (e.touches.length !== 2) {
          isTwoFingerTouch = false;
          return;
        }
        isTwoFingerTouch = true;
        initialPinchDistance = getDistance(e.touches);
        initialZoom = area.area.transform.k;
        const center = getTouchCenter(e.touches);
        lastTouchCenterX = center.x;
        lastTouchCenterY = center.y;
      };

      const handleTouchMove = (e: TouchEvent) => {
        // Only handle 2-finger touch, let 1-finger through for parent scroll
        if (e.touches.length !== 2 || !isTwoFingerTouch) {
          return;
        }

        const currentDistance = getDistance(e.touches);
        const center = getTouchCenter(e.touches);
        const rect = container.getBoundingClientRect();

        // Calculate pan delta from center movement
        const panDx = center.x - lastTouchCenterX;
        const panDy = center.y - lastTouchCenterY;
        lastTouchCenterX = center.x;
        lastTouchCenterY = center.y;

        // Calculate zoom from pinch
        const scale = currentDistance / initialPinchDistance;
        const newZoom = Math.max(0.1, Math.min(2.0, initialZoom * scale));

        const { x, y, k } = area.area.transform;

        // Apply pan first
        let newX = x + panDx;
        let newY = y + panDy;

        // Then apply zoom around the current pinch center
        const currentPinchCenterX = center.x - rect.left;
        const currentPinchCenterY = center.y - rect.top;
        newX = currentPinchCenterX - (currentPinchCenterX - newX) * (newZoom / k);
        newY = currentPinchCenterY - (currentPinchCenterY - newY) * (newZoom / k);

        area.area.zoom(newZoom, 0, 0);
        area.area.translate(newX, newY);
        updateBackground();
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          initialPinchDistance = 0;
          isTwoFingerTouch = false;
        }
      };

      touchHandlersRef.current = {
        start: handleTouchStart,
        move: handleTouchMove,
        end: handleTouchEnd,
      };
      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: true });
      container.addEventListener('touchend', handleTouchEnd, { passive: true });

      // Handle tap on nodes for mobile selection
      let touchStartTarget: HTMLElement | null = null;
      let touchMoved = false;

      const handleNodeTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          touchStartTarget = e.target as HTMLElement;
          touchMoved = false;
        }
      };

      const handleNodeTouchMove = () => {
        touchMoved = true;
      };

      const handleNodeTouchEnd = (e: TouchEvent) => {
        if (touchMoved || !touchStartTarget) {
          touchStartTarget = null;
          return;
        }

        const target = touchStartTarget;
        touchStartTarget = null;

        // Check if tap was on a node (not on input/button elements)
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' || target.tagName === 'BUTTON') {
          // Focus the input element
          (target as HTMLElement).focus();
          return;
        }

        // Check if tap was on a node
        const nodeElement = target.closest('.custom-node');
        if (nodeElement) {
          const nodeId = nodeElement.getAttribute('data-node-id');
          if (nodeId && selectorRef.current) {
            // Select the node
            const node = editor.getNode(nodeId);
            if (node) {
              selectorRef.current.unselectAll();
              selectorRef.current.add({ id: nodeId, label: 'node' }, true);
              // Emit picked event to update visual selection
              area.emit({ type: 'nodepicked', data: { id: nodeId } });
            }
          }
          e.preventDefault();
          return;
        }

        // Check if tap was on a socket
        const inputSocket = target.closest('.custom-node-input');
        const outputSocket = target.closest('.custom-node-output');
        if (inputSocket || outputSocket) {
          // Socket handling is done elsewhere
          return;
        }
      };

      nodeTouchHandlersRef.current = {
        start: handleNodeTouchStart,
        move: handleNodeTouchMove,
        end: handleNodeTouchEnd,
      };
      // Use capture phase to intercept events before Rete.js handlers
      container.addEventListener('touchstart', handleNodeTouchStart, { passive: true, capture: true });
      container.addEventListener('touchmove', handleNodeTouchMove, { passive: true, capture: true });
      container.addEventListener('touchend', handleNodeTouchEnd, { passive: false, capture: true });

      // Enable selection and node dragging
      const selector = AreaExtensions.selector();
      selectorRef.current = selector;
      AreaExtensions.selectableNodes(area, selector, {
        accumulating: AreaExtensions.accumulateOnCtrl(),
      });
      AreaExtensions.simpleNodesOrder(area);

      // ========================================
      // Custom drag-to-connect state machine
      // ========================================
      // States: 'idle' | 'pressing' | 'dragging'
      let dragState: 'idle' | 'pressing' | 'dragging' = 'idle';
      let dragSourceSocket: { nodeId: string; socketKey: string; side: 'input' | 'output'; element: HTMLElement } | null = null;
      let dragStartPos: { x: number; y: number } | null = null;
      let dragCurrentTarget: HTMLElement | null = null;
      let tempConnectionLine: SVGPathElement | null = null;
      let lastPointerDownOnSocket = false;

      // Function to find connection by socket
      const findConnectionBySocket = (nodeId: string, socketKey: string, side: 'input' | 'output') => {
        const connections = editor.getConnections();
        if (side === 'input') {
          return connections.find(c => c.target === nodeId && c.targetInput === socketKey);
        } else {
          return connections.find(c => c.source === nodeId && c.sourceOutput === socketKey);
        }
      };

      // Function to check if a connection already exists
      const connectionExists = (sourceId: string, sourceOutput: string, targetId: string, targetInput: string) => {
        const connections = editor.getConnections();
        return connections.some(c =>
          c.source === sourceId &&
          c.sourceOutput === sourceOutput &&
          c.target === targetId &&
          c.targetInput === targetInput
        );
      };

      // Helper to get socket info from element
      const getSocketInfo = (element: HTMLElement): { nodeId: string; socketKey: string; side: 'input' | 'output'; container: HTMLElement } | null => {
        const inputSocket = element.closest('.custom-node-input') as HTMLElement | null;
        const outputSocket = element.closest('.custom-node-output') as HTMLElement | null;
        if (!inputSocket && !outputSocket) return null;

        const nodeElement = element.closest('.custom-node') as HTMLElement | null;
        if (!nodeElement) return null;

        const nodeId = nodeElement.getAttribute('data-node-id');
        if (!nodeId) return null;

        const side = outputSocket ? 'output' : 'input';
        const socketContainer = (outputSocket || inputSocket)!;
        const testId = socketContainer.getAttribute('data-testid');
        let socketKey = side;
        if (testId && testId.includes('-')) {
          socketKey = testId.substring(testId.indexOf('-') + 1);
        }

        return { nodeId, socketKey, side, container: socketContainer };
      };

      // Helper to highlight a socket
      const highlightSocket = (container: HTMLElement, color: 'green' | 'blue') => {
        const innerSocket = container.querySelector('.custom-socket') as HTMLElement;
        if (innerSocket) {
          if (color === 'green') {
            container.classList.add('socket-selected');
            innerSocket.style.background = '#4ade80';
            innerSocket.style.borderColor = '#22c55e';
            innerSocket.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.6)';
          } else {
            container.classList.add('socket-target');
            innerSocket.style.background = '#60a5fa';
            innerSocket.style.borderColor = '#3b82f6';
            innerSocket.style.boxShadow = '0 0 8px rgba(59, 130, 246, 0.6)';
          }
        }
      };

      // Helper to unhighlight a target socket (clears blue highlight)
      const unhighlightSocket = (container: HTMLElement) => {
        container.classList.remove('socket-target');
        const innerSocket = container.querySelector('.custom-socket') as HTMLElement;
        if (innerSocket && !container.classList.contains('socket-selected')) {
          innerSocket.style.background = '';
          innerSocket.style.borderColor = '';
          innerSocket.style.boxShadow = '';
        }
      };

      // Dedicated SVG overlay for temp connection (created once)
      let tempConnectionSvg: SVGSVGElement | null = null;

      // Helper to create/update temp connection line (uses screen coordinates relative to container)
      const updateTempConnection = (startScreenX: number, startScreenY: number, endScreenX: number, endScreenY: number) => {
        // Create dedicated SVG overlay if it doesn't exist
        if (!tempConnectionSvg) {
          tempConnectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          tempConnectionSvg.style.position = 'absolute';
          tempConnectionSvg.style.top = '0';
          tempConnectionSvg.style.left = '0';
          tempConnectionSvg.style.width = '100%';
          tempConnectionSvg.style.height = '100%';
          tempConnectionSvg.style.overflow = 'visible';
          tempConnectionSvg.style.pointerEvents = 'none';
          tempConnectionSvg.style.zIndex = '10000';
          container.appendChild(tempConnectionSvg);
        }

        if (!tempConnectionLine) {
          tempConnectionLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          tempConnectionLine.classList.add('temp-connection-line');
          tempConnectionLine.style.pointerEvents = 'none';
          tempConnectionSvg.appendChild(tempConnectionLine);
        }

        // Create vertical bezier curve (using screen coordinates)
        const yDistance = Math.abs(endScreenY - startScreenY);
        const xDistance = Math.abs(endScreenX - startScreenX);
        const offset = Math.max(yDistance * 0.4, xDistance / 2, 30);

        const d = `M ${startScreenX} ${startScreenY} C ${startScreenX} ${startScreenY + offset}, ${endScreenX} ${endScreenY - offset}, ${endScreenX} ${endScreenY}`;
        tempConnectionLine.setAttribute('d', d);
      };

      // Helper to remove temp connection line
      const removeTempConnection = () => {
        if (tempConnectionLine) {
          tempConnectionLine.remove();
          tempConnectionLine = null;
        }
      };

      // Helper to create connection with validation
      const tryCreateConnection = (
        sourceNodeId: string,
        sourceOutput: string,
        targetNodeId: string,
        targetInput: string
      ): boolean => {
        const sourceNode = editor.getNode(sourceNodeId);
        const targetNode = editor.getNode(targetNodeId);
        if (sourceNode && targetNode && sourceNodeId !== targetNodeId &&
            !connectionExists(sourceNodeId, sourceOutput, targetNodeId, targetInput) &&
            areSocketsCompatible(sourceNode as NodeTypes, sourceOutput, targetNode as NodeTypes, targetInput) &&
            !wouldCreateCycle(editor.getConnections(), sourceNodeId, targetNodeId)) {
          const conn = new ClassicPreset.Connection(
            sourceNode,
            sourceOutput as never,
            targetNode,
            targetInput as never
          );
          editor.addConnection(conn);
          return true;
        }
        return false;
      };

      // POINTERDOWN handler
      container.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        const socketInfo = getSocketInfo(target);

        lastPointerDownOnSocket = !!socketInfo;

        if (!socketInfo) {
          // Clicked elsewhere - clear selection
          pendingConnectionRef.current = null;
          selectedConnectionIdRef.current = null;
          clearSocketSelection(container);
          dragState = 'idle';
          return;
        }

        // Unselect all nodes when clicking on socket
        if (selectorRef.current) {
          selectorRef.current.unselectAll();
        }

        // Check if there's a pending connection (click-to-connect)
        const pending = pendingConnectionRef.current;
        if (pending && (pending.nodeId !== socketInfo.nodeId || pending.socketKey !== socketInfo.socketKey)) {
          // Try to connect the two sockets
          let connected = false;
          if (pending.side === 'output' && socketInfo.side === 'input') {
            tryCreateConnection(pending.nodeId, pending.socketKey, socketInfo.nodeId, socketInfo.socketKey);
            connected = true;
          } else if (pending.side === 'input' && socketInfo.side === 'output') {
            tryCreateConnection(socketInfo.nodeId, socketInfo.socketKey, pending.nodeId, pending.socketKey);
            connected = true;
          }
          if (connected) {
            // Clear selection after successful connection
            pendingConnectionRef.current = null;
            selectedConnectionIdRef.current = null;
            clearSocketSelection(container);
            dragState = 'idle';
            return;
          }
        }

        // Check if this socket has a connection
        const existingConnection = findConnectionBySocket(socketInfo.nodeId, socketInfo.socketKey, socketInfo.side);

        // Store source socket info
        dragSourceSocket = {
          nodeId: socketInfo.nodeId,
          socketKey: socketInfo.socketKey,
          side: socketInfo.side,
          element: socketInfo.container,
        };
        dragStartPos = { x: e.clientX, y: e.clientY };

        // Clear previous selection and highlight new socket (green)
        clearSocketSelection(container);
        highlightSocket(socketInfo.container, 'green');

        // Store for click-to-connect and delete functionality
        pendingConnectionRef.current = { nodeId: socketInfo.nodeId, socketKey: socketInfo.socketKey, side: socketInfo.side };
        selectedConnectionIdRef.current = existingConnection?.id ?? null;

        dragState = 'pressing';
      }, true);

      // POINTERMOVE handler
      container.addEventListener('pointermove', (e) => {
        if (dragState === 'idle' || !dragSourceSocket || !dragStartPos) return;

        // Use elementFromPoint to get the actual element under the pointer
        const elementUnderPointer = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;

        if (dragState === 'pressing') {
          // Check if mouse has left the source socket area
          const isStillOnSourceSocket = elementUnderPointer &&
            dragSourceSocket.element.contains(elementUnderPointer);

          if (!isStillOnSourceSocket) {
            // Mouse dragged out of the socket - start dragging
            dragState = 'dragging';
            container.setPointerCapture(e.pointerId);
          }
        }

        if (dragState === 'dragging') {
          // Update temp connection line using screen coordinates relative to container
          const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
          const socketRect = dragSourceSocket.element.getBoundingClientRect();
          const startX = socketRect.left + socketRect.width / 2 - containerRect.left;
          const startY = socketRect.top + socketRect.height / 2 - containerRect.top;
          const endX = e.clientX - containerRect.left;
          const endY = e.clientY - containerRect.top;

          // Swap start/end for input sockets (draw from top)
          if (dragSourceSocket.side === 'input') {
            updateTempConnection(endX, endY, startX, startY);
          } else {
            updateTempConnection(startX, startY, endX, endY);
          }

          // Check if over a target socket
          const targetSocketInfo = elementUnderPointer ? getSocketInfo(elementUnderPointer) : null;
          if (targetSocketInfo && targetSocketInfo.container !== dragSourceSocket.element) {
            // Highlight target socket (blue)
            if (dragCurrentTarget !== targetSocketInfo.container) {
              // Unhighlight previous target
              if (dragCurrentTarget) {
                unhighlightSocket(dragCurrentTarget);
              }
              dragCurrentTarget = targetSocketInfo.container;
              highlightSocket(targetSocketInfo.container, 'blue');
            }
          } else {
            // Unhighlight previous target
            if (dragCurrentTarget) {
              unhighlightSocket(dragCurrentTarget);
              dragCurrentTarget = null;
            }
          }
        }
      }, true);

      // POINTERUP handler
      container.addEventListener('pointerup', (e) => {
        if (dragState === 'idle' || !dragSourceSocket) {
          return;
        }

        // Use elementFromPoint to get the actual element under the pointer
        const elementUnderPointer = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const targetSocketInfo = elementUnderPointer ? getSocketInfo(elementUnderPointer) : null;

        try {
          container.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore if not captured
        }

        if (dragState === 'pressing') {
          // Simple click - socket stays selected, go to idle
          dragState = 'idle';
          dragSourceSocket = null;
          dragStartPos = null;
          return;
        }

        // dragState === 'dragging'
        removeTempConnection();

        // Unhighlight target
        if (dragCurrentTarget) {
          unhighlightSocket(dragCurrentTarget);
          dragCurrentTarget = null;
        }

        if (targetSocketInfo && targetSocketInfo.container !== dragSourceSocket.element) {
          // Released on a different socket - try to connect
          if (dragSourceSocket.side === 'output' && targetSocketInfo.side === 'input') {
            tryCreateConnection(
              dragSourceSocket.nodeId,
              dragSourceSocket.socketKey,
              targetSocketInfo.nodeId,
              targetSocketInfo.socketKey
            );
          } else if (dragSourceSocket.side === 'input' && targetSocketInfo.side === 'output') {
            tryCreateConnection(
              targetSocketInfo.nodeId,
              targetSocketInfo.socketKey,
              dragSourceSocket.nodeId,
              dragSourceSocket.socketKey
            );
          }
        }
        // Released on same socket or empty space - socket stays selected

        dragState = 'idle';
        dragSourceSocket = null;
        dragStartPos = null;
      }, true);

      // Cancel node picking/dragging when drag starts from socket
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      area.addPipe((context: any) => {
        if (lastPointerDownOnSocket) {
          if (context.type === 'nodepicked' || context.type === 'nodetranslate') {
            return undefined; // Cancel the event
          }
        }
        return context;
      });

      // Save graph when node position changes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      area.addPipe((context: any) => {
        if (context.type === 'nodetranslated') {
          setTimeout(saveCurrentGraph, 0);
        }
        return context;
      });

      container.setAttribute('tabindex', '0'); // Make container focusable

      // Handle node removal and connection changes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.addPipe((context: any) => {
        if (context.type === 'noderemoved') {
          const node = context.data as NodeTypes;
          if (getNodeType(node) === 'Timeline') {
            onTimelineRemove(node.id);
          }
          setTimeout(saveCurrentGraph, 0);
          // Rebuild pipeline after node removal
          setTimeout(() => rebuildPipelineRef.current?.(), 0);
        }
        if (context.type === 'connectioncreated' || context.type === 'connectionremoved') {
          setTimeout(saveCurrentGraph, 0);
          // Rebuild pipeline when connections change
          setTimeout(() => rebuildPipelineRef.current?.(), 0);
          // Force update nodes to refresh socket positions and clear ghost connections
          if (context.type === 'connectionremoved') {
            const conn = context.data;
            setTimeout(() => {
              const sourceNode = editor.getNode(conn.source);
              const targetNode = editor.getNode(conn.target);
              if (sourceNode) area.update('node', sourceNode.id);
              if (targetNode) area.update('node', targetNode.id);
            }, 10);
          }
        }
        return context;
      });

      // Check for permalink query parameters (?e= for nevent, ?a= for naddr)
      const urlParams = new URLSearchParams(window.location.search);
      const neventParam = urlParams.get('e');
      const naddrParam = urlParams.get('a');

      // Parse nevent parameter (legacy format - points to specific event)
      let permalinkEventId: string | null = null;
      if (neventParam) {
        if (isHex64(neventParam)) {
          permalinkEventId = neventParam;
        } else if (neventParam.startsWith('nevent1')) {
          const decoded = decodeBech32ToHex(neventParam);
          if (decoded && decoded.type === 'nevent') {
            permalinkEventId = decoded.hex;
          }
        }
      }

      // Parse naddr parameter (new format - points to latest version)
      let permalinkNaddr: { kind: number; pubkey: string; dTag: string; relays: string[] } | null = null;
      if (naddrParam && naddrParam.startsWith('naddr1')) {
        permalinkNaddr = naddrDecode(naddrParam);
      }

      const hasPermalink = permalinkEventId !== null || permalinkNaddr !== null;

      // Load saved graph (skip if we have a permalink - will load from Nostr later)
      if (hasPermalink) {
        // Load from permalink - don't create default graph
        onLoadingChange?.(true);
        setTimeout(async () => {
          try {
            let graphData: GraphData | null = null;

            if (permalinkNaddr) {
              // Load by naddr (kind + pubkey + d-tag) - gets latest version
              graphData = await loadGraphByNaddr(
                permalinkNaddr.kind,
                permalinkNaddr.pubkey,
                permalinkNaddr.dTag,
                permalinkNaddr.relays.length > 0 ? permalinkNaddr.relays : undefined
              );
            } else if (permalinkEventId) {
              // Load by event ID (legacy nevent format)
              graphData = await loadGraphByEventId(permalinkEventId);
            }

            if (graphData) {
              await loadGraphDataRef.current?.(graphData);
              // Clear URL params after successful load (Issue #8)
              // This prevents reload from overwriting user edits
              window.history.replaceState(null, '', window.location.pathname);
            } else {
              // Graph not found - show warning and leave empty
              window.alert(
                'Graph not found.\n\n' +
                'Possible reasons:\n' +
                '- Network issue\n' +
                '- Graph was deleted\n' +
                '- Author changed their relays'
              );
            }
          } catch (err) {
            console.error('Failed to load graph from permalink:', err);
            window.alert(
              'Failed to load graph.\n\n' +
              'Possible reasons:\n' +
              '- Network issue\n' +
              '- Graph was deleted\n' +
              '- Author changed their relays'
            );
          } finally {
            onLoadingChange?.(false);
          }
        }, 500);
      } else {
        // No permalink - load from localStorage or create default
        const savedGraph = loadGraph();
        if (savedGraph) {
          await loadGraphDataRef.current?.(savedGraph);
        } else {
          // Create default graph when localStorage is empty
          isLoadingRef.current = true;

          // Create default Relay node (at top)
          const relayNode = new SimpleRelayNode();
          await editor.addNode(relayNode);
          await area.translate(relayNode.id, { x: 100, y: 100 });

          // Create default Timeline node (below Relay node - vertical arrangement)
          const timelineNode = new TimelineNode();
          await editor.addNode(timelineNode);
          await area.translate(timelineNode.id, { x: 120, y: 650 });
          onTimelineCreate(timelineNode.id, timelineNode.getTimelineName());

          // Connect Relay node to Timeline node
          const conn = new ClassicPreset.Connection(
            relayNode,
            'output' as never,
            timelineNode,
            'input' as never
          );
          await editor.addConnection(conn);

          isLoadingRef.current = false;

          // Save the default graph
          saveCurrentGraph();

          // Rebuild the Observable pipeline
          setTimeout(() => rebuildPipelineRef.current?.(), 100);

          // Fit view to show all nodes (delay to ensure DOM is ready)
          setTimeout(async () => {
            await AreaExtensions.zoomAt(area, editor.getNodes());
            // Adjust for toolbar height (move view down)
            const { x, y } = area.area.transform;
            area.area.translate(x, y + 30);
          }, 150);
        }
      }
    };

    initEditor();

    return () => {
      // Remove wheel listener
      if (wheelHandlerRef.current && containerRef.current) {
        containerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
      }
      // Remove pointer listeners
      if (pointerHandlersRef.current && containerRef.current) {
        containerRef.current.removeEventListener('pointerdown', pointerHandlersRef.current.down);
        containerRef.current.removeEventListener('pointermove', pointerHandlersRef.current.move);
        containerRef.current.removeEventListener('pointerup', pointerHandlersRef.current.up);
      }
      // Remove touch listeners
      if (touchHandlersRef.current && containerRef.current) {
        containerRef.current.removeEventListener('touchstart', touchHandlersRef.current.start);
        containerRef.current.removeEventListener('touchmove', touchHandlersRef.current.move);
        containerRef.current.removeEventListener('touchend', touchHandlersRef.current.end);
      }
      // Remove node touch listeners (must match capture phase)
      if (nodeTouchHandlersRef.current && containerRef.current) {
        containerRef.current.removeEventListener('touchstart', nodeTouchHandlersRef.current.start, { capture: true });
        containerRef.current.removeEventListener('touchmove', nodeTouchHandlersRef.current.move, { capture: true });
        containerRef.current.removeEventListener('touchend', nodeTouchHandlersRef.current.end, { capture: true });
      }
      if (areaRef.current) {
        areaRef.current.destroy();
      }
    };
  }, [onTimelineCreate, onTimelineRemove, onLoadingChange, saveCurrentGraph]);

  // Keyboard shortcuts - separate useEffect to access latest callbacks
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't handle shortcuts if focus is on an input element
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      const key = e.key.toLowerCase();

      // Handle Ctrl+S for save, Ctrl+O for load, Ctrl+P for post
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === 's') {
          e.preventDefault();
          setSaveDialogOpen(true);
          return;
        }
        if (key === 'o') {
          e.preventDefault();
          setLoadDialogOpen(true);
          return;
        }
        if (key === 'p') {
          e.preventDefault();
          setPostDialogOpen(true);
          return;
        }
      }

      // Don't handle other shortcuts with modifier keys (Ctrl, Alt, Meta)
      if (e.ctrlKey || e.altKey || e.metaKey) {
        return;
      }

      // Delete selected nodes with Delete, Backspace, or 'd' key
      if (e.key === 'Delete' || e.key === 'Backspace' || key === 'd') {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // r = add Relay node
      if (key === 'r') {
        e.preventDefault();
        addNode('SimpleRelay');
        return;
      }

      // f = toggle Filter dropdown
      if (key === 'f') {
        e.preventDefault();
        setFilterDropdownOpen(prev => !prev);
        return;
      }

      // t = add Timeline node
      if (key === 't') {
        e.preventDefault();
        addNode('Timeline');
        return;
      }

      // c = center view
      if (key === 'c') {
        e.preventDefault();
        centerView();
        return;
      }

      // o = add Operator node
      if (key === 'o') {
        e.preventDefault();
        addNode('Operator');
        setFilterDropdownOpen(false);
        return;
      }

      // s = add Search node
      if (key === 's') {
        e.preventDefault();
        addNode('Search');
        setFilterDropdownOpen(false);
        return;
      }

      // l = add Language node
      if (key === 'l') {
        e.preventDefault();
        addNode('Language');
        setFilterDropdownOpen(false);
        return;
      }

      // n = add NostrFilter node
      if (key === 'n') {
        e.preventDefault();
        addNode('NostrFilter');
        setFilterDropdownOpen(false);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addNode, centerView, deleteSelected]);

  return (
    <div className="graph-editor">
      <div className="graph-toolbar">
        <div className="toolbar-row">
          <button onClick={() => setPostDialogOpen(true)} className="post-btn">{t('toolbar.post')}</button>
          <button onClick={centerView}>{t('toolbar.center')}</button>
          <button onClick={() => setLoadDialogOpen(true)}>{t('toolbar.load')}</button>
          <button onClick={() => setSaveDialogOpen(true)}>{t('toolbar.save')}</button>
        </div>
        <div className="toolbar-row">
          <button onClick={() => setEditPanelOpen(!editPanelOpen)} className={editPanelOpen ? 'close-btn' : ''}>
            {editPanelOpen ? t('toolbar.close', 'Close') : t('toolbar.edit', 'Edit')} {editPanelOpen ? '▲' : '▼'}
          </button>
        </div>
        {editPanelOpen && (
          <>
            <div className="toolbar-row">
              <div className="filter-dropdown" ref={inputDropdownRef}>
                <button onClick={() => setInputDropdownOpen(!inputDropdownOpen)}>
                  {t('toolbar.input', '+Input')} ▶
                </button>
                {inputDropdownOpen && (
                  <div className="filter-dropdown-menu horizontal">
                    <button onClick={() => { addNode('SimpleRelay'); setInputDropdownOpen(false); }}>{t('toolbar.simpleRelay', 'Relay (Simple)')}</button>
                    <button onClick={() => { addNode('ModularRelay'); setInputDropdownOpen(false); }}>{t('toolbar.modularRelay', 'Relay (Modular)')}</button>
                    <button onClick={() => { addNode('Constant'); setInputDropdownOpen(false); }}>{t('toolbar.constant', 'Constant')}</button>
                    <button onClick={() => { addNode('Nip07'); setInputDropdownOpen(false); }}>{t('toolbar.nip07', 'NIP-07')}</button>
                  </div>
                )}
              </div>
            </div>
            <div className="toolbar-row">
              <button onClick={() => addNode('Timeline')}>{t('toolbar.output', '+Output')}</button>
            </div>
            <div className="toolbar-row">
              <div className="filter-dropdown" ref={filterDropdownRef}>
                <button onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}>
                  {t('toolbar.filter')} ▶
                </button>
                {filterDropdownOpen && (
                  <div className="filter-dropdown-menu horizontal">
                    <button onClick={() => { addNode('Operator'); setFilterDropdownOpen(false); }}>{t('toolbar.operator')}</button>
                    <button onClick={() => { addNode('Search'); setFilterDropdownOpen(false); }}>{t('toolbar.search')}</button>
                    <button onClick={() => { addNode('Language'); setFilterDropdownOpen(false); }}>{t('toolbar.language')}</button>
                    <button onClick={() => { addNode('NostrFilter'); setFilterDropdownOpen(false); }}>{t('toolbar.nostrFilter')}</button>
                    <button onClick={() => { addNode('Extraction'); setFilterDropdownOpen(false); }}>{t('toolbar.extraction', 'Extraction')}</button>
                    <button onClick={() => { addNode('If'); setFilterDropdownOpen(false); }}>{t('toolbar.if', 'If')}</button>
                    <button onClick={() => { addNode('Count'); setFilterDropdownOpen(false); }}>{t('toolbar.count', 'Count')}</button>
                    <button onClick={() => { addNode('Sampling'); setFilterDropdownOpen(false); }}>{t('toolbar.sampling', 'Sampling')}</button>
                    <button onClick={() => { addNode('Delay'); setFilterDropdownOpen(false); }}>{t('toolbar.delay', 'Delay')}</button>
                  </div>
                )}
              </div>
            </div>
            <div className="toolbar-row">
              <div className="filter-dropdown" ref={functionDropdownRef}>
                <button onClick={() => setFunctionDropdownOpen(!functionDropdownOpen)}>
                  {t('toolbar.functionMenu', '+Func')} ▶
                </button>
                {functionDropdownOpen && (
                  <div className="filter-dropdown-menu horizontal">
                    <button onClick={() => { addNode('FuncDefIn'); setFunctionDropdownOpen(false); }}>{t('toolbar.funcDefIn', 'Func In')}</button>
                    <button onClick={() => { addNode('FuncDefOut'); setFunctionDropdownOpen(false); }}>{t('toolbar.funcDefOut', 'Func Out')}</button>
                    <button onClick={() => { addNode('Function'); setFunctionDropdownOpen(false); }}>{t('toolbar.function', 'Function')}</button>
                  </div>
                )}
              </div>
            </div>
            <div className="toolbar-row">
              <button onClick={deleteSelected} className="delete-btn">{t('toolbar.delete')}</button>
            </div>
            <div className="toolbar-row">
              <button onClick={clearAll} className="clear-btn">{t('toolbar.clear', 'Clear')}</button>
            </div>
          </>
        )}
      </div>
      <div
        ref={containerRef}
        className="graph-editor-container"
        onClick={() => {
          setInputDropdownOpen(false);
          setFilterDropdownOpen(false);
          setFunctionDropdownOpen(false);
        }}
      />
      <div className="footer-info">
        <span className="version-info">v{APP_VERSION} ({BUILD_TIMESTAMP})</span>
        <a
          href="https://github.com/koteitan/mojimoji"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          title="View on GitHub"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
      </div>

      {/* Save Dialog */}
      <SaveDialog
        isOpen={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSave}
      />

      {/* Load Dialog */}
      <LoadDialog
        isOpen={loadDialogOpen}
        onClose={() => setLoadDialogOpen(false)}
        onLoad={handleLoad}
      />

      {/* Post Dialog */}
      <PostDialog
        isOpen={postDialogOpen}
        onClose={() => setPostDialogOpen(false)}
      />

      {/* Debug bar (ws mode only) */}
      {hasWsParam() && (
        <div className="debug-bar">
          <button
            onClick={() => {
              if (wsConnected) {
                disconnectWs();
                setWsConnected(false);
              } else {
                connectWs();
                setTimeout(() => setWsConnected(isWsConnected()), 500);
              }
            }}
            className={wsConnected ? 'disconnect-btn' : 'connect-btn'}
          >
            {wsConnected ? 'Disconnect' : 'Connect'}
          </button>
          <button onClick={() => (window as any).dumpall?.()}>dumpall</button>
          <button onClick={() => (window as any).dumpsub?.()}>dumpsub</button>
          <button onClick={() => (window as any).dumpobstream?.()}>dumpobstream</button>
          <button onClick={() => (window as any).dumptl?.()}>dumptl</button>
        </div>
      )}
    </div>
  );
}
