import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

import { SourceNode, OperatorNode, SearchNode, DisplayNode } from './nodes';
import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl } from './nodes/controls';
import { TextInputComponent, TextAreaComponent, SelectComponent, CheckboxComponent } from './CustomControls';
import { saveGraph, loadGraph } from '../../utils/localStorage';
import type { TimelineEvent, NostrEvent } from '../../nostr/types';
import type { Observable } from 'rxjs';
import './GraphEditor.css';

type NodeTypes = SourceNode | OperatorNode | SearchNode | DisplayNode;

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

  const saveCurrentGraph = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || isLoadingRef.current) return;

    const nodes = editor.getNodes().map((node: NodeTypes) => ({
      id: node.id,
      type: node.label,
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

  // Get the output Observable from a node by traversing connections
  const getNodeOutput = useCallback((nodeId: string): Observable<NostrEvent> | null => {
    const editor = editorRef.current;
    if (!editor) return null;

    const node = editor.getNode(nodeId);
    if (!node) return null;

    if (node.label === 'Source') {
      return (node as SourceNode).output$;
    } else if (node.label === 'Operator') {
      return (node as OperatorNode).output$;
    } else if (node.label === 'Search') {
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
      if (node.label === 'Source') {
        (node as SourceNode).stopSubscription();
      } else if (node.label === 'Operator') {
        (node as OperatorNode).stopSubscriptions();
      } else if (node.label === 'Search') {
        (node as SearchNode).stopSubscription();
      } else if (node.label === 'Display') {
        (node as DisplayNode).stopSubscription();
      }
    }

    // Find which Source nodes need to be active (connected to a Display eventually)
    const activeSourceIds = new Set<string>();
    const findActiveSources = (nodeId: string, visited: Set<string>) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = editor.getNode(nodeId);
      if (!node) return;

      if (node.label === 'Source') {
        activeSourceIds.add(nodeId);
        return;
      }

      // Find connections where this node is the target
      const incomingConns = connections.filter(
        (c: { target: string }) => c.target === nodeId
      );

      for (const conn of incomingConns) {
        findActiveSources(conn.source, visited);
      }
    };

    // Find active sources for each Display node
    for (const node of nodes) {
      if (node.label === 'Display') {
        findActiveSources(node.id, new Set());
      }
    }

    // Start subscriptions on active Source nodes
    for (const node of nodes) {
      if (node.label === 'Source' && activeSourceIds.has(node.id)) {
        (node as SourceNode).startSubscription();
      }
    }

    // Wire up Operator nodes
    for (const node of nodes) {
      if (node.label === 'Operator') {
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
      if (node.label === 'Search') {
        const searchNode = node as SearchNode;

        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        searchNode.setInput(input$);
      }
    }

    // Wire up Display nodes
    for (const node of nodes) {
      if (node.label === 'Display') {
        const displayNode = node as DisplayNode;
        const displayNodeId = node.id;

        // Initialize events array
        eventsRef.current.set(displayNodeId, []);

        // Set the event callback
        displayNode.setOnEvent((event: NostrEvent) => {
          const events = eventsRef.current.get(displayNodeId) || [];
          // Add event and sort by created_at (newest first)
          const newEvents = [...events, { event, profile: undefined }].sort(
            (a, b) => b.event.created_at - a.event.created_at
          );
          // Limit to 100 events
          const limitedEvents = newEvents.slice(0, 100);
          eventsRef.current.set(displayNodeId, limitedEvents);
          onEventsUpdate(displayNodeId, limitedEvents);
        });

        // Find input connection
        const inputConn = connections.find(
          (c: { target: string }) => c.target === node.id
        );
        const input$ = inputConn ? getNodeOutput(inputConn.source) : null;

        displayNode.setInput(input$);
      }
    }
  }, [getNodeOutput, onEventsUpdate]);

  // Keep ref updated
  rebuildPipelineRef.current = rebuildPipeline;

  const addNode = useCallback(async (type: 'Source' | 'Operator' | 'Search' | 'Display') => {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;

    let node: NodeTypes;

    switch (type) {
      case 'Source':
        node = new SourceNode();
        break;
      case 'Operator':
        node = new OperatorNode();
        break;
      case 'Search':
        node = new SearchNode();
        break;
      case 'Display':
        node = new DisplayNode();
        onTimelineCreate(node.id, (node as DisplayNode).getTimelineName());
        break;
      default:
        return;
    }

    await editor.addNode(node);

    // Position the node in the center of the visible area
    const { x, y } = area.area.pointer;
    await area.translate(node.id, { x: x || 100, y: y || 100 });

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
    if (!editor || !selector) return;

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

      // Set up connection presets
      connection.addPreset(ConnectionPresets.classic.setup());

      // Set up render presets with custom control rendering
      render.addPreset(
        Presets.classic.setup({
          customize: {
            control(data: { payload: ClassicPreset.Control }) {
              if (data.payload instanceof TextInputControl) {
                return TextInputComponent;
              }
              if (data.payload instanceof TextAreaControl) {
                return TextAreaComponent;
              }
              if (data.payload instanceof SelectControl) {
                return SelectComponent;
              }
              if (data.payload instanceof CheckboxControl) {
                return CheckboxComponent;
              }
              return null;
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
        const isNode = target.closest('.node');
        const isConnection = target.closest('.connection');
        const isSocket = target.closest('.socket');

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

      // Enable zoom and drag
      const selector = AreaExtensions.selector();
      selectorRef.current = selector;
      AreaExtensions.selectableNodes(area, selector, {
        accumulating: AreaExtensions.accumulateOnCtrl(),
      });
      AreaExtensions.simpleNodesOrder(area);

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
          if (node.label === 'Display') {
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
        }
        return context;
      });

      // Load saved graph
      const savedGraph = loadGraph();
      if (savedGraph) {
        isLoadingRef.current = true;
        const nodeMap = new Map<string, NodeTypes>();
        const displayNodes: Array<{ node: DisplayNode; id: string }> = [];

        // Create nodes
        for (const nodeData of savedGraph.nodes as Array<{
          id: string;
          type: string;
          position: { x: number; y: number };
          data: unknown;
        }>) {
          let node: NodeTypes;

          switch (nodeData.type) {
            case 'Source':
              node = new SourceNode();
              if (nodeData.data) {
                (node as SourceNode).deserialize(nodeData.data as { relayUrls: string[]; filterJson: string });
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
            case 'Display':
              node = new DisplayNode();
              if (nodeData.data) {
                (node as DisplayNode).deserialize(nodeData.data as { timelineName: string });
              }
              // Delay onTimelineCreate until after ID is overridden
              displayNodes.push({ node: node as DisplayNode, id: nodeData.id });
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

        // Now create timelines for Display nodes with correct IDs
        for (const { node, id } of displayNodes) {
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
        <button onClick={() => addNode('Source')}>{t('toolbar.relay')}</button>
        <button onClick={() => addNode('Operator')}>{t('toolbar.operator')}</button>
        <button onClick={() => addNode('Search')}>{t('toolbar.search')}</button>
        <button onClick={() => addNode('Display')}>{t('toolbar.timeline')}</button>
        <button onClick={centerView}>{t('toolbar.center')}</button>
        <button onClick={deleteSelected} className="delete-btn">{t('toolbar.delete')}</button>
      </div>
      <div ref={containerRef} className="graph-editor-container" />
    </div>
  );
}
