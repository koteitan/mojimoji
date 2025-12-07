import { useEffect, useRef, useCallback } from 'react';
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';

import { SourceNode, OperatorNode, SearchNode, DisplayNode } from './nodes';
import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl } from './nodes/controls';
import { TextInputComponent, TextAreaComponent, SelectComponent, CheckboxComponent } from './CustomControls';
import { saveGraph, loadGraph } from '../../utils/localStorage';
import type { TimelineEvent } from '../../nostr/types';
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
}: GraphEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<NodeEditor<Schemes> | null>(null);
  const areaRef = useRef<AreaPlugin<Schemes, AreaExtra> | null>(null);
  const keydownHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectorRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const isLoadingRef = useRef(false);

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

      // Handle node removal - clean up Display nodes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.addPipe((context: any) => {
        if (context.type === 'noderemoved') {
          const node = context.data as NodeTypes;
          if (node.label === 'Display') {
            onTimelineRemove(node.id);
          }
          setTimeout(saveCurrentGraph, 0);
        }
        if (context.type === 'connectioncreated' || context.type === 'connectionremoved') {
          setTimeout(saveCurrentGraph, 0);
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
      }
    };

    initEditor();

    return () => {
      // Remove keydown listener
      if (keydownHandlerRef.current) {
        document.removeEventListener('keydown', keydownHandlerRef.current);
      }
      if (areaRef.current) {
        areaRef.current.destroy();
      }
    };
  }, [onTimelineCreate, onTimelineRemove, saveCurrentGraph]);

  return (
    <div className="graph-editor">
      <div className="graph-toolbar">
        <button onClick={() => addNode('Source')}>+ Source</button>
        <button onClick={() => addNode('Operator')}>+ Operator</button>
        <button onClick={() => addNode('Search')}>+ Search</button>
        <button onClick={() => addNode('Display')}>+ Display</button>
        <button onClick={deleteSelected} className="delete-btn">Delete</button>
      </div>
      <div ref={containerRef} className="graph-editor-container" />
    </div>
  );
}
