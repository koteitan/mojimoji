import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin } from 'rete-connection-plugin';
import { ConnectionPathPlugin } from 'rete-connection-path-plugin';
import { ReactPlugin, Presets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

import { RelayNode, OperatorNode, SearchNode, LanguageNode, NostrFilterNode, TimelineNode, getCachedProfile, getProfileCacheInfo } from './nodes';
import { CustomNode } from './CustomNode';
import { CustomConnection } from './CustomConnection';
import { CustomSocket } from './CustomSocket';
import { SaveDialog, LoadDialog } from '../Dialogs';
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
import { saveGraphToNostr, loadGraphByPath } from '../../nostr/graphStorage';
import type { TimelineEvent, EventSignal } from '../../nostr/types';
import type { Observable, Subscription } from 'rxjs';
import './GraphEditor.css';

// Version: Update this on each deployment
const APP_VERSION = '0.5.1';

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

type NodeTypes = RelayNode | OperatorNode | SearchNode | LanguageNode | NostrFilterNode | TimelineNode;

// Helper to get the internal node type
const getNodeType = (node: NodeTypes): string => {
  return (node as NodeTypes & { nodeType: string }).nodeType;
};

// Use 'any' to bypass strict Rete.js type constraints
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schemes = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AreaExtra = any;

interface GraphEditorProps {
  onTimelineCreate: (id: string, name: string) => void;
  onTimelineRemove: (id: string) => void;
  onEventsUpdate: (id: string, events: TimelineEvent[]) => void;
}

export function GraphEditor({
  onTimelineCreate,
  onTimelineRemove,
  onEventsUpdate,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectorRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const isLoadingRef = useRef(false);
  const eventsRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  // Track event IDs that should be excluded (received 'remove' before 'add')
  const excludedEventsRef = useRef<Map<string, Set<string>>>(new Map());
  const rebuildPipelineRef = useRef<(() => void) | null>(null);
  const profileSubscriptionsRef = useRef<Subscription[]>([]);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const pendingConnectionRef = useRef<{ nodeId: string; socketKey: string; side: 'input' | 'output' } | null>(null);

  // State for filter dropdown
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  // State for save/load dialogs
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);

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
      console.log('Editor not initialized');
      return;
    }

    const nodes = editor.getNodes();
    const connections = editor.getConnections();

    const lines: string[] = ['=== Graph Dump ===', '', 'Nodes:'];
    for (const node of nodes) {
      const pos = areaRef.current?.nodeViews.get(node.id)?.position || { x: 0, y: 0 };
      const type = (node as NodeTypes & { nodeType: string }).nodeType;
      lines.push(`  [${type}] ${node.id} (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
    }

    lines.push('', 'Connections:');
    for (const conn of connections) {
      lines.push(`  ${conn.source}.${conn.sourceOutput} -> ${conn.target}.${conn.targetInput}`);
    }

    lines.push('', '==================');
    console.log(lines.join('\n'));
  }, []);

  // Debug function to dump subscription state to console
  const dumpSub = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      console.log('Editor not initialized');
      return;
    }

    const nodes = editor.getNodes();
    const lines: string[] = ['=== Subscription Dump ===', ''];

    for (const node of nodes) {
      const type = getNodeType(node);
      if (type === 'Relay') {
        const relayNode = node as RelayNode;
        const isActive = relayNode.isSubscribed();
        const isProfileActive = relayNode.isProfileSubscribed();
        const pendingProfiles = relayNode.getPendingProfileCount();
        const relays = relayNode.getRelayUrls();
        const filters = relayNode.getFilters();
        const status = isActive ? 'ON' : 'OFF';
        const profileStatus = isProfileActive ? 'ON' : 'OFF';

        lines.push(`[${status}] ${node.id} | ${relays.join(', ')} | ${JSON.stringify(filters)}`);
        lines.push(`  └─ [profile: ${profileStatus}] pending: ${pendingProfiles}`);
      }
    }

    lines.push('========================');
    console.log(lines.join('\n'));
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
    console.log(lines.join('\n'));
  }, []);

  // Expose debug functions to window
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpgraph = dumpGraph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpsub = dumpSub;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).infocache = infoCache;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpgraph;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpsub;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).infocache;
    };
  }, [dumpGraph, dumpSub, infoCache]);

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
  }, [saveCurrentGraph, findDownstreamTimelines]);

  // Get the output Observable from a node by traversing connections
  const getNodeOutput = useCallback((nodeId: string): Observable<EventSignal> | null => {
    const editor = editorRef.current;
    if (!editor) return null;

    const node = editor.getNode(nodeId);
    if (!node) return null;

    if (getNodeType(node) === 'Relay') {
      return (node as RelayNode).output$;
    } else if (getNodeType(node) === 'Operator') {
      return (node as OperatorNode).output$;
    } else if (getNodeType(node) === 'Search') {
      return (node as SearchNode).output$;
    } else if (getNodeType(node) === 'Language') {
      return (node as LanguageNode).output$;
    } else if (getNodeType(node) === 'NostrFilter') {
      return (node as NostrFilterNode).output$;
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
      if (getNodeType(node) === 'Relay') {
        (node as RelayNode).stopSubscription();
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
      }
    }

    // Find which Relay nodes need to be active (connected to a Timeline eventually)
    const activeRelayIds = new Set<string>();
    const findActiveRelays = (nodeId: string, visited: Set<string>) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = editor.getNode(nodeId);
      if (!node) return;

      if (getNodeType(node) === 'Relay') {
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

    // Start subscriptions on active Relay nodes and subscribe to profile updates
    for (const node of nodes) {
      if (getNodeType(node) === 'Relay' && activeRelayIds.has(node.id)) {
        const relayNode = node as RelayNode;
        relayNode.startSubscription();

        // Subscribe to profile updates from this relay
        const profileSub = relayNode.profile$.subscribe({
          next: ({ pubkey, profile }) => {
            // Update all events with this pubkey across all timelines
            for (const [timelineId, events] of eventsRef.current) {
              let updated = false;
              for (const event of events) {
                if (event.event.pubkey === pubkey && !event.profile) {
                  event.profile = profile;
                  updated = true;
                }
              }
              if (updated) {
                onEventsUpdate(timelineId, [...events]);
              }
            }
          },
        });
        profileSubscriptionsRef.current.push(profileSub);
      }
    }

    // Wire up Operator nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'Operator') {
        const operatorNode = node as OperatorNode;

        // Find input1 connection
        const input1Conn = connections.find(
          (c: { target: string; targetInput: string }) =>
            c.target === node.id && c.targetInput === 'input1'
        );
        const input1$ = input1Conn ? getNodeOutput(input1Conn.source) : null;

        // Find input2 connection
        const input2Conn = connections.find(
          (c: { target: string; targetInput: string }) =>
            c.target === node.id && c.targetInput === 'input2'
        );
        const input2$ = input2Conn ? getNodeOutput(input2Conn.source) : null;

        operatorNode.setInputs(input1$, input2$);
      }
    }

    // Wire up Search nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'Search') {
        const searchNode = node as SearchNode;

        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        searchNode.setInput(input$);
      }
    }

    // Wire up Language nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'Language') {
        const languageNode = node as LanguageNode;

        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        languageNode.setInput(input$);
      }
    }

    // Wire up NostrFilter nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'NostrFilter') {
        const nostrFilterNode = node as NostrFilterNode;

        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        nostrFilterNode.setInput(input$);
      }
    }

    // Wire up Timeline nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'Timeline') {
        const timelineNode = node as TimelineNode;
        const timelineNodeId = node.id;

        // Find input connection
        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        // Clear events only for specified timelines, or all if no specific ones
        const shouldClear = timelinesToClearRef.current === null ||
                           timelinesToClearRef.current.has(timelineNodeId) ||
                           !input$; // Always clear if no input connection
        if (shouldClear) {
          eventsRef.current.set(timelineNodeId, []);
          excludedEventsRef.current.set(timelineNodeId, new Set()); // Also clear excluded set
          onEventsUpdate(timelineNodeId, []);
        }

        // Initialize excluded set for this timeline
        if (!excludedEventsRef.current.has(timelineNodeId)) {
          excludedEventsRef.current.set(timelineNodeId, new Set());
        }
        const excludedSet = excludedEventsRef.current.get(timelineNodeId)!;

        // Set the signal callback - handles both 'add' and 'remove' signals
        timelineNode.setOnSignal((signal: EventSignal) => {
          const events = eventsRef.current.get(timelineNodeId) || [];

          if (signal.signal === 'add') {
            // Skip if event is in excluded set (remove arrived before add)
            if (excludedSet.has(signal.event.id)) {
              // Remove from excluded set since we've now processed the add
              excludedSet.delete(signal.event.id);
              return;
            }
            // Skip if event already exists (deduplication)
            if (events.some(e => e.event.id === signal.event.id)) {
              return;
            }
            // Try to get cached profile
            const cachedProfile = getCachedProfile(signal.event.pubkey);
            // Add event and sort by created_at (newest first)
            const newEvents = [...events, { event: signal.event, profile: cachedProfile }].sort(
              (a, b) => b.event.created_at - a.event.created_at
            );
            // Limit to 100 events
            const limitedEvents = newEvents.slice(0, 100);
            eventsRef.current.set(timelineNodeId, limitedEvents);
            onEventsUpdate(timelineNodeId, limitedEvents);
          } else if (signal.signal === 'remove') {
            // Remove event from timeline
            const filteredEvents = events.filter(e => e.event.id !== signal.event.id);
            // If something was removed
            if (filteredEvents.length !== events.length) {
              eventsRef.current.set(timelineNodeId, filteredEvents);
              onEventsUpdate(timelineNodeId, filteredEvents);
            } else {
              // Event not found - add to excluded set so future 'add' will be ignored
              excludedSet.add(signal.event.id);
            }
          }
        });

        timelineNode.setInput(input$);
      }
    }
  }, [getNodeOutput, onEventsUpdate]);

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

    // Clear events
    eventsRef.current.clear();
    excludedEventsRef.current.clear();

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
        case 'Relay':
        case 'Source': // backward compatibility
          node = new RelayNode();
          if (nodeData.data) {
            (node as RelayNode).deserialize(nodeData.data as { relayUrls: string[]; filterJson: string });
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
            (node as TimelineNode).deserialize(nodeData.data as { timelineName: string });
          }
          // Delay onTimelineCreate until after ID is overridden
          timelineNodes.push({ node: node as TimelineNode, id: nodeData.id });
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

    // Create connections
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
        const conn = new ClassicPreset.Connection(
          sourceNode,
          connData.sourceOutput as never,
          targetNode,
          connData.targetInput as never
        );
        await editor.addConnection(conn);
      }
    }

    isLoadingRef.current = false;

    // Rebuild the Observable pipeline after loading
    setTimeout(() => rebuildPipelineRef.current?.(), 100);

    // Restore view transform if available, otherwise fit view to show all nodes
    setTimeout(async () => {
      if (graphData.viewTransform) {
        // Restore saved view transform
        area.area.zoom(graphData.viewTransform.k, 0, 0);
        area.area.translate(graphData.viewTransform.x, graphData.viewTransform.y);
      } else {
        // Fit view to show all nodes
        await AreaExtensions.zoomAt(area, editor.getNodes());
        const { x, y } = area.area.transform;
        area.area.translate(x, y + 30);
      }
    }, 150);

    // Save to auto-save slot
    saveCurrentGraph();
  }, [onTimelineCreate, onTimelineRemove, saveCurrentGraph]);

  // Handle save dialog save action
  const handleSave = useCallback(async (
    destination: 'local' | 'nostr' | 'file',
    path: string,
    options?: { visibility?: 'public' | 'private'; relayUrls?: string[] }
  ) => {
    const graphData = getCurrentGraphData();
    if (!graphData) return;

    if (destination === 'local') {
      saveGraphToPath(path, graphData);
    } else if (destination === 'file') {
      exportGraphToFile(graphData, path);
    } else if (destination === 'nostr') {
      await saveGraphToNostr(path, graphData, {
        visibility: options?.visibility || 'private',
        relayUrls: options?.relayUrls,
      });
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

  const addNode = useCallback(async (type: 'Relay' | 'Operator' | 'Search' | 'Language' | 'NostrFilter' | 'Timeline') => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;

    let node: NodeTypes;

    switch (type) {
      case 'Relay':
        node = new RelayNode();
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

        if (type === 'Relay') {
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
      if (container) {
        container.querySelectorAll('.socket-selected').forEach(el => {
          el.classList.remove('socket-selected');
          const innerSocket = el.querySelector('.custom-socket') as HTMLElement;
          if (innerSocket) {
            innerSocket.style.background = '';
            innerSocket.style.borderColor = '';
            innerSocket.style.boxShadow = '';
          }
        });
      }
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

      // Don't add connection presets - we handle connections manually via click-to-connect
      // This prevents pseudo-connection visual artifacts


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

      // Configure connection path for vertical flow (top to bottom)
      // Custom transformer that creates vertical bezier curves
      // Also corrects for horizontal offset applied by classic preset
      const verticalTransformer = () => (points: { x: number; y: number }[]) => {
        if (points.length !== 2) throw new Error('need 2 points');
        const [start, end] = points;

        // Remove horizontal offset by moving start left and end right
        // The classic preset adds ~12px offset (output right, input left)
        const horizontalCorrection = 12;
        const correctedStart = { x: start.x - horizontalCorrection, y: start.y };
        const correctedEnd = { x: end.x + horizontalCorrection, y: end.y };

        // Calculate vertical offset for bezier control points
        const yDistance = Math.abs(correctedEnd.y - correctedStart.y);
        const xDistance = Math.abs(correctedEnd.x - correctedStart.x);
        const offset = Math.max(yDistance * 0.4, xDistance / 2, 30);

        // Create vertical bezier: start -> control1 (below start) -> control2 (above end) -> end
        const control1 = { x: correctedStart.x, y: correctedStart.y + offset };
        const control2 = { x: correctedEnd.x, y: correctedEnd.y - offset };

        return [correctedStart, control1, control2, correctedEnd];
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

      // Add pinch zoom handler for touch devices
      let initialPinchDistance = 0;
      let initialZoom = 1;
      let pinchCenterX = 0;
      let pinchCenterY = 0;

      const getDistance = (touches: TouchList) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          initialPinchDistance = getDistance(e.touches);
          initialZoom = area.area.transform.k;
          const rect = container.getBoundingClientRect();
          pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2 && initialPinchDistance > 0) {
          e.preventDefault();
          const currentDistance = getDistance(e.touches);
          const scale = currentDistance / initialPinchDistance;
          const newZoom = Math.max(0.1, Math.min(2.0, initialZoom * scale));

          const { x, y, k } = area.area.transform;
          // Calculate new position to keep pinch center fixed
          const newX = pinchCenterX - (pinchCenterX - x) * (newZoom / k);
          const newY = pinchCenterY - (pinchCenterY - y) * (newZoom / k);

          area.area.zoom(newZoom, 0, 0);
          area.area.translate(newX, newY);
          updateBackground();
        }
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          initialPinchDistance = 0;
        }
      };

      touchHandlersRef.current = {
        start: handleTouchStart,
        move: handleTouchMove,
        end: handleTouchEnd,
      };
      container.addEventListener('touchstart', handleTouchStart, { passive: false });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd);

      // Enable selection and node dragging
      const selector = AreaExtensions.selector();
      selectorRef.current = selector;
      AreaExtensions.selectableNodes(area, selector, {
        accumulating: AreaExtensions.accumulateOnCtrl(),
      });
      AreaExtensions.simpleNodesOrder(area);

      // Track socket interactions for manual connection creation and selection
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

      container.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        const inputSocket = target.closest('.custom-node-input');
        const outputSocket = target.closest('.custom-node-output');

        lastPointerDownOnSocket = !!(inputSocket || outputSocket);

        if (inputSocket || outputSocket) {
          // Unselect all nodes when clicking on socket
          if (selectorRef.current) {
            selectorRef.current.unselectAll();
          }

          // Find the node this socket belongs to
          const nodeElement = target.closest('.custom-node') as HTMLElement | null;

          if (nodeElement) {
            // Get node ID from our custom data-node-id attribute
            const nodeId = nodeElement.getAttribute('data-node-id');

            if (nodeId) {
              const side = outputSocket ? 'output' : 'input';
              // Get socket key from data-testid (format: "input-keyName" or "output-keyName")
              const socketContainer = outputSocket || inputSocket;
              const testId = socketContainer?.getAttribute('data-testid');
              let socketKey = side; // fallback
              if (testId && testId.includes('-')) {
                socketKey = testId.substring(testId.indexOf('-') + 1);
              }

              // Check if this socket has a connection
              const existingConnection = findConnectionBySocket(nodeId, socketKey, side);

              // Clear previous socket selection highlight
              container.querySelectorAll('.socket-selected').forEach(el => {
                el.classList.remove('socket-selected');
                // Clear inline styles
                const innerSocket = el.querySelector('.custom-socket') as HTMLElement;
                if (innerSocket) {
                  innerSocket.style.background = '';
                  innerSocket.style.borderColor = '';
                  innerSocket.style.boxShadow = '';
                }
              });

              if (pendingConnectionRef.current) {
                // Second click - create connection
                if (pendingConnectionRef.current.side === 'output' && side === 'input') {
                  // Connect output -> input
                  const sourceNode = editor.getNode(pendingConnectionRef.current.nodeId);
                  const targetNode = editor.getNode(nodeId);
                  const sourceOutput = pendingConnectionRef.current.socketKey;
                  const targetInput = socketKey;
                  // Check for duplicate connection
                  if (sourceNode && targetNode && pendingConnectionRef.current.nodeId !== nodeId &&
                      !connectionExists(pendingConnectionRef.current.nodeId, sourceOutput, nodeId, targetInput)) {
                    const conn = new ClassicPreset.Connection(
                      sourceNode,
                      sourceOutput as never,
                      targetNode,
                      targetInput as never
                    );
                    editor.addConnection(conn);
                  }
                } else if (pendingConnectionRef.current.side === 'input' && side === 'output') {
                  // Connect output -> input (reverse order)
                  const sourceNode = editor.getNode(nodeId);
                  const targetNode = editor.getNode(pendingConnectionRef.current.nodeId);
                  const sourceOutput = socketKey;
                  const targetInput = pendingConnectionRef.current.socketKey;
                  // Check for duplicate connection
                  if (sourceNode && targetNode && pendingConnectionRef.current.nodeId !== nodeId &&
                      !connectionExists(nodeId, sourceOutput, pendingConnectionRef.current.nodeId, targetInput)) {
                    const conn = new ClassicPreset.Connection(
                      sourceNode,
                      sourceOutput as never,
                      targetNode,
                      targetInput as never
                    );
                    editor.addConnection(conn);
                  }
                }
                pendingConnectionRef.current = null;
                selectedConnectionIdRef.current = null;
              } else {
                // First click - store pending connection and existing connection (if any)
                pendingConnectionRef.current = { nodeId, socketKey, side };
                // Store existing connection for potential deletion via delete button
                selectedConnectionIdRef.current = existingConnection?.id ?? null;
                // Highlight the selected socket (green)
                socketContainer?.classList.add('socket-selected');
                const innerSocket = socketContainer?.querySelector('.custom-socket') as HTMLElement;
                if (innerSocket) {
                  innerSocket.style.background = '#4ade80';
                  innerSocket.style.borderColor = '#22c55e';
                  innerSocket.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.6)';
                }
              }
            }
          }
        } else {
          // Clicked elsewhere, cancel pending connection and selection
          pendingConnectionRef.current = null;
          selectedConnectionIdRef.current = null;
          // Clear socket selection highlight
          container.querySelectorAll('.socket-selected').forEach(el => {
            el.classList.remove('socket-selected');
            // Clear inline styles
            const innerSocket = el.querySelector('.custom-socket') as HTMLElement;
            if (innerSocket) {
              innerSocket.style.background = '';
              innerSocket.style.borderColor = '';
              innerSocket.style.boxShadow = '';
            }
          });
        }
      }, true); // Use capture phase to run before rete's handlers

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

      // Load saved graph
      const savedGraph = loadGraph();
      if (savedGraph) {
        isLoadingRef.current = true;
        const nodeMap = new Map<string, NodeTypes>();
        const timelineNodes: Array<{ node: TimelineNode; id: string }> = [];

        // Create nodes
        for (const nodeData of savedGraph.nodes as Array<{
          id: string;
          type: string;
          position: { x: number; y: number };
          data: unknown;
        }>) {
          let node: NodeTypes;

          switch (nodeData.type) {
            case 'Relay':
            case 'Source': // backward compatibility
              node = new RelayNode();
              if (nodeData.data) {
                (node as RelayNode).deserialize(nodeData.data as { relayUrls: string[]; filterJson: string });
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
                (node as TimelineNode).deserialize(nodeData.data as { timelineName: string });
              }
              // Delay onTimelineCreate until after ID is overridden
              timelineNodes.push({ node: node as TimelineNode, id: nodeData.id });
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

        // Create connections
        for (const connData of savedGraph.connections as Array<{
          id: string;
          source: string;
          sourceOutput: string;
          target: string;
          targetInput: string;
        }>) {
          const sourceNode = nodeMap.get(connData.source);
          const targetNode = nodeMap.get(connData.target);

          if (sourceNode && targetNode) {
            const conn = new ClassicPreset.Connection(
              sourceNode,
              connData.sourceOutput as never,
              targetNode,
              connData.targetInput as never
            );
            await editor.addConnection(conn);
          }
        }

        isLoadingRef.current = false;

        // Rebuild the Observable pipeline after loading
        setTimeout(() => rebuildPipelineRef.current?.(), 100);

        // Restore view transform if available, otherwise fit view to show all nodes
        setTimeout(async () => {
          if (savedGraph.viewTransform) {
            // Restore saved view transform
            area.area.zoom(savedGraph.viewTransform.k, 0, 0);
            area.area.translate(savedGraph.viewTransform.x, savedGraph.viewTransform.y);
          } else {
            // Fit view to show all nodes (delay to ensure DOM is ready)
            await AreaExtensions.zoomAt(area, editor.getNodes());
            // Adjust for toolbar height (move view down)
            const { x, y } = area.area.transform;
            area.area.translate(x, y + 30);
          }
        }, 150);
      } else {
        // Create default graph when localStorage is empty
        isLoadingRef.current = true;

        // Create default Relay node (at top)
        const relayNode = new RelayNode();
        await editor.addNode(relayNode);
        await area.translate(relayNode.id, { x: 100, y: 100 });

        // Create default Timeline node (below Relay node - vertical arrangement)
        const timelineNode = new TimelineNode();
        await editor.addNode(timelineNode);
        await area.translate(timelineNode.id, { x: 120, y: 400 });
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
      if (areaRef.current) {
        areaRef.current.destroy();
      }
    };
  }, [onTimelineCreate, onTimelineRemove, saveCurrentGraph]);

  // Keyboard shortcuts - separate useEffect to access latest callbacks
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't handle shortcuts if focus is on an input element
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      const key = e.key.toLowerCase();

      // Handle Ctrl+S for save and Ctrl+O for load
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
        addNode('Relay');
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
        <button onClick={() => addNode('Relay')}>{t('toolbar.relay')}</button>
        <div className="filter-dropdown">
          <button onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}>
            {t('toolbar.filter')} ▼
          </button>
          {filterDropdownOpen && (
            <div className="filter-dropdown-menu">
              <button onClick={() => { addNode('Operator'); setFilterDropdownOpen(false); }}>{t('toolbar.operator')}</button>
              <button onClick={() => { addNode('Search'); setFilterDropdownOpen(false); }}>{t('toolbar.search')}</button>
              <button onClick={() => { addNode('Language'); setFilterDropdownOpen(false); }}>{t('toolbar.language')}</button>
              <button onClick={() => { addNode('NostrFilter'); setFilterDropdownOpen(false); }}>{t('toolbar.nostrFilter')}</button>
            </div>
          )}
        </div>
        <button onClick={() => addNode('Timeline')}>{t('toolbar.timeline')}</button>
        <button onClick={centerView}>{t('toolbar.center')}</button>
        <button onClick={deleteSelected} className="delete-btn">{t('toolbar.delete')}</button>
        <div className="toolbar-separator" />
        <button onClick={() => setSaveDialogOpen(true)}>{t('toolbar.save')}</button>
        <button onClick={() => setLoadDialogOpen(true)}>{t('toolbar.load')}</button>
      </div>
      <div ref={containerRef} className="graph-editor-container" />
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
    </div>
  );
}
