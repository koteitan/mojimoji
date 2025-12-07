import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin } from 'rete-connection-plugin';
import { ReactPlugin, Presets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

import { RelayNode, OperatorNode, SearchNode, TimelineNode } from './nodes';
import { CustomNode } from './CustomNode';
import { saveGraph, loadGraph } from '../../utils/localStorage';
import type { TimelineEvent, NostrEvent } from '../../nostr/types';
import type { Observable } from 'rxjs';
import './GraphEditor.css';

// Debug flag for development
const DEBUG = false;

type NodeTypes = RelayNode | OperatorNode | SearchNode | TimelineNode;

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
  const keydownHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const pointerHandlersRef = useRef<{
    down: (e: PointerEvent) => void;
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectorRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const isLoadingRef = useRef(false);
  const eventsRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  const rebuildPipelineRef = useRef<(() => void) | null>(null);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const pendingConnectionRef = useRef<{ nodeId: string; socketKey: string; side: 'input' | 'output' } | null>(null);

  const saveCurrentGraph = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || isLoadingRef.current) return;

    const nodes = editor.getNodes().map((node: NodeTypes) => ({
      id: node.id,
      type: (node as NodeTypes & { nodeType: string }).nodeType,
      position: areaRef.current?.nodeViews.get(node.id)?.position || { x: 0, y: 0 },
      data: 'serialize' in node ? (node as unknown as { serialize: () => unknown }).serialize() : {},
    }));

    const connections = editor.getConnections().map((conn: ClassicPreset.Connection<NodeTypes, NodeTypes>) => ({
      id: conn.id,
      source: conn.source,
      sourceOutput: conn.sourceOutput,
      target: conn.target,
      targetInput: conn.targetInput,
    }));

    saveGraph({ nodes, connections });
  }, []);

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
        const relays = relayNode.getRelayUrls();
        const filter = relayNode.getFilter();
        const status = isActive ? 'ON' : 'OFF';

        lines.push(`[${status}] ${node.id} | ${relays.join(', ')} | ${JSON.stringify(filter)}`);
      }
    }

    lines.push('========================');
    console.log(lines.join('\n'));
  }, []);

  // Expose debug functions to window
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpgraph = dumpGraph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).dumpsub = dumpSub;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpgraph;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).dumpsub;
    };
  }, [dumpGraph, dumpSub]);

  // Listen for control changes to save to localStorage
  useEffect(() => {
    const handleControlChange = () => {
      saveCurrentGraph();
    };
    window.addEventListener('graph-control-change', handleControlChange);
    return () => {
      window.removeEventListener('graph-control-change', handleControlChange);
    };
  }, [saveCurrentGraph]);

  // Get the output Observable from a node by traversing connections
  const getNodeOutput = useCallback((nodeId: string): Observable<NostrEvent> | null => {
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
    }

    return null;
  }, []);

  // Rebuild the Observable pipeline for all nodes
  const rebuildPipeline = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const connections = editor.getConnections();
    const nodes = editor.getNodes();

    // First, stop all existing subscriptions
    for (const node of nodes) {
      if (getNodeType(node) === 'Relay') {
        (node as RelayNode).stopSubscription();
      } else if (getNodeType(node) === 'Operator') {
        (node as OperatorNode).stopSubscriptions();
      } else if (getNodeType(node) === 'Search') {
        (node as SearchNode).stopSubscription();
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

    // Start subscriptions on active Relay nodes
    for (const node of nodes) {
      if (getNodeType(node) === 'Relay' && activeRelayIds.has(node.id)) {
        (node as RelayNode).startSubscription();
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

        // Clear events if no input connection
        if (!input$) {
          eventsRef.current.set(timelineNodeId, []);
          onEventsUpdate(timelineNodeId, []);
        }

        // Set the event callback
        timelineNode.setOnEvent((event: NostrEvent) => {
          const events = eventsRef.current.get(timelineNodeId) || [];
          // Skip if event already exists (deduplication)
          if (events.some(e => e.event.id === event.id)) {
            return;
          }
          // Add event and sort by created_at (newest first)
          const newEvents = [...events, { event, profile: undefined }].sort(
            (a, b) => b.event.created_at - a.event.created_at
          );
          // Limit to 100 events
          const limitedEvents = newEvents.slice(0, 100);
          eventsRef.current.set(timelineNodeId, limitedEvents);
          onEventsUpdate(timelineNodeId, limitedEvents);
        });

        timelineNode.setInput(input$);
      }
    }
  }, [getNodeOutput, onEventsUpdate]);

  // Keep ref updated
  rebuildPipelineRef.current = rebuildPipeline;

  const addNode = useCallback(async (type: 'Relay' | 'Operator' | 'Search' | 'Timeline') => {
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
          const innerSocket = el.querySelector('div > div') as HTMLElement;
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

    for (const id of selected) {
      // Remove 'node_' prefix if present (selector adds this prefix)
      const nodeId = id.startsWith('node_') ? id.slice(5) : id;
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


      // Set up render presets with custom node only
      render.addPreset(
        Presets.classic.setup({
          customize: {
            node() {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return CustomNode as any;
            },
          },
        })
      );

      editor.use(area);
      area.use(connection);
      area.use(render);

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
              if (DEBUG) console.log('Socket clicked:', { nodeId, socketKey, side });
              const existingConnection = findConnectionBySocket(nodeId, socketKey, side);
              if (DEBUG) console.log('Existing connection:', existingConnection);

              // Clear previous socket selection highlight
              container.querySelectorAll('.socket-selected').forEach(el => {
                el.classList.remove('socket-selected');
                // Clear inline styles
                const innerSocket = el.querySelector('div > div') as HTMLElement;
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
                const innerSocket = socketContainer?.querySelector('div > div') as HTMLElement;
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
            const innerSocket = el.querySelector('div > div') as HTMLElement;
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

      // Delete selected nodes with Delete or Backspace key
      const handleKeyDown = async (e: KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // Don't prevent default if focus is on an input element
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return;
          }
          e.preventDefault();
          // Get selected node IDs from the selector
          const selected: string[] = [];
          selector.entities.forEach((_value: unknown, id: string) => {
            selected.push(id);
          });

          for (const id of selected) {
            const node = editor.getNode(id);
            if (node) {
              // Remove connections first
              const connections = editor.getConnections().filter(
                (c: { source: string; target: string }) => c.source === id || c.target === id
              );
              for (const conn of connections) {
                await editor.removeConnection(conn.id);
              }
              // Remove node
              await editor.removeNode(id);
            }
          }
        }
      };

      // Store handler in ref for cleanup
      keydownHandlerRef.current = handleKeyDown;
      document.addEventListener('keydown', handleKeyDown);
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

        // Fit view to show all nodes
        await AreaExtensions.zoomAt(area, editor.getNodes());

        // Rebuild the Observable pipeline after loading
        setTimeout(() => rebuildPipelineRef.current?.(), 100);
      } else {
        // Create default graph when localStorage is empty
        isLoadingRef.current = true;

        // Create default Relay node
        const relayNode = new RelayNode();
        await editor.addNode(relayNode);
        await area.translate(relayNode.id, { x: 100, y: 150 });

        // Create default Timeline node
        const timelineNode = new TimelineNode();
        await editor.addNode(timelineNode);
        await area.translate(timelineNode.id, { x: 400, y: 150 });
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

        // Fit view to show all nodes
        await AreaExtensions.zoomAt(area, editor.getNodes());

        // Rebuild the Observable pipeline
        setTimeout(() => rebuildPipelineRef.current?.(), 100);
      }
    };

    initEditor();

    return () => {
      // Remove keydown listener
      if (keydownHandlerRef.current) {
        document.removeEventListener('keydown', keydownHandlerRef.current);
      }
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
      if (areaRef.current) {
        areaRef.current.destroy();
      }
    };
  }, [onTimelineCreate, onTimelineRemove, saveCurrentGraph]);

  return (
    <div className="graph-editor">
      <div className="graph-toolbar">
        <button onClick={() => addNode('Relay')}>{t('toolbar.relay')}</button>
        <button onClick={() => addNode('Operator')}>{t('toolbar.operator')}</button>
        <button onClick={() => addNode('Search')}>{t('toolbar.search')}</button>
        <button onClick={() => addNode('Timeline')}>{t('toolbar.timeline')}</button>
        <button onClick={centerView}>{t('toolbar.center')}</button>
        <button onClick={deleteSelected} className="delete-btn">{t('toolbar.delete')}</button>
      </div>
      <div ref={containerRef} className="graph-editor-container" />
    </div>
  );
}
