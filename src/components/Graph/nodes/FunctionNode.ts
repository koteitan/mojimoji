import { ClassicPreset } from 'rete';
import { Subject, Observable, Subscription } from 'rxjs';
import i18next from 'i18next';
import { anySocket, getSocketByType } from './types';
import { TextInputControl, StatusLampControl, type StatusLampState } from './controls';
import type { SocketDefinition, FuncDefSignal } from './FuncDefInNode';
import type { GraphData } from '../../../graph/types';

// Import node types for internal instantiation
import { IfNode, type IfComparisonType, type ComparisonOperator } from './IfNode';
import { ConstantNode, type ConstantType } from './ConstantNode';
import { CountNode } from './CountNode';
import { ExtractionNode, type ExtractionField, type RelayFilterType } from './ExtractionNode';

// Internal node instance type
type InternalNode = IfNode | ConstantNode | CountNode | ExtractionNode;

// Node data from graph JSON
interface NodeData {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

// Connection data from graph JSON
interface ConnectionData {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

// Function definition loaded from Nostr
export interface FunctionDefinition {
  path: string;
  pubkey: string;
  graphData: GraphData;
  inputSockets: SocketDefinition[];
  outputSockets: SocketDefinition[];
}

export class FunctionNode extends ClassicPreset.Node {
  static readonly nodeType = 'Function';
  readonly nodeType = 'Function';
  width = 220;
  height: number | undefined = undefined;

  private functionPath: string = '';

  // Status lamp
  private status: StatusLampState = 'idle';

  // Loaded function definition
  private functionDef: FunctionDefinition | null = null;

  // Input observables
  private inputs$: Map<string, Observable<FuncDefSignal> | null> = new Map();

  // Output subjects
  private outputSubjects: Map<string, Subject<FuncDefSignal>> = new Map();

  // Subscriptions for wiring
  private subscriptions: Subscription[] = [];

  // Internal node instances (for function expansion)
  private internalNodes: Map<string, InternalNode> = new Map();

  // FuncDefIn/FuncDefOut node IDs from function definition
  private funcDefInId: string | null = null;
  private funcDefOutId: string | null = null;

  // Callback for loading function (set by GraphEditor)
  private loadFunctionCallback: ((path: string) => Promise<FunctionDefinition | null>) | null = null;

  constructor() {
    super(i18next.t('nodes.function.title', 'Function'));

    // Add status lamp control
    this.addControl(
      'status',
      new StatusLampControl('idle', 'idle')
    );

    // Add function path control
    this.addControl(
      'path',
      new TextInputControl(
        this.functionPath,
        i18next.t('nodes.function.path', 'Function Path'),
        (value) => {
          this.functionPath = value;
          // Don't load immediately - wait for blur
        },
        true, // rebuildPipeline on blur
        'user/function-name'
      )
    );
  }

  // Set callback for loading functions (called by GraphEditor)
  setLoadFunctionCallback(callback: (path: string) => Promise<FunctionDefinition | null>): void {
    this.loadFunctionCallback = callback;
  }

  // Load function definition and update sockets
  async loadFunction(): Promise<void> {
    if (!this.functionPath) {
      this.setStatus('idle', 'idle');
      return;
    }

    if (!this.loadFunctionCallback) {
      this.setStatus('error', 'no loader');
      return;
    }

    this.setStatus('loading', 'loading in nostr...');

    try {
      const def = await this.loadFunctionCallback(this.functionPath);
      if (!def) {
        this.setStatus('error', 'not found');
        return;
      }

      this.functionDef = def;
      this.updateSocketsFromDefinition();
      this.setStatus('working', 'working');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.setStatus('error', message);
    }
  }

  private setStatus(state: StatusLampState, message: string): void {
    this.status = state;

    const control = this.controls['status'] as StatusLampControl;
    if (control) {
      control.setState(state, message);
    }

    // Notify UI to update
    window.dispatchEvent(new CustomEvent('graph-control-change', { detail: { nodeId: this.id, rebuildPipeline: false } }));
  }

  // @ts-ignore - keep for future use
  private clearSockets(): void {
    // Stop subscriptions
    this.stopSubscription();

    // Clear internal nodes
    this.internalNodes.clear();
    this.funcDefInId = null;
    this.funcDefOutId = null;

    // Remove all inputs
    for (const key of Object.keys(this.inputs)) {
      this.removeInput(key);
    }
    this.inputs$.clear();

    // Remove all outputs
    for (const key of Object.keys(this.outputs)) {
      this.removeOutput(key);
    }
    this.outputSubjects.clear();

    this.functionDef = null;

    // Notify graph to re-render
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  private updateSocketsFromDefinition(): void {
    if (!this.functionDef) return;

    // Stop existing internal subscriptions (but keep outputSubjects for downstream subscribers)
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    // Clear internal nodes
    this.internalNodes.clear();
    this.funcDefInId = null;
    this.funcDefOutId = null;

    // Preserve existing outputSubjects (downstream nodes may be subscribed)
    const existingOutputSubjects = new Map(this.outputSubjects);
    // Preserve existing input observables (already wired from rebuildPipeline)
    const existingInputs$ = new Map(this.inputs$);

    // Remove existing sockets
    for (const key of Object.keys(this.inputs)) {
      this.removeInput(key);
    }
    this.inputs$.clear();

    for (const key of Object.keys(this.outputs)) {
      this.removeOutput(key);
    }
    this.outputSubjects.clear();

    // Add input sockets based on function definition
    // Restore existing input observables if available
    for (let i = 0; i < this.functionDef.inputSockets.length; i++) {
      const def = this.functionDef.inputSockets[i];
      const key = `in_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addInput(key, new ClassicPreset.Input(socket, def.name));
      // Restore existing observable or set to null
      const existingInput$ = existingInputs$.get(key);
      this.inputs$.set(key, existingInput$ || null);
    }

    // Add output sockets based on function definition
    // Reuse existing subjects if available to maintain downstream subscriptions
    for (let i = 0; i < this.functionDef.outputSockets.length; i++) {
      const def = this.functionDef.outputSockets[i];
      const key = `out_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addOutput(key, new ClassicPreset.Output(socket, def.name));

      // Reuse existing subject or create new one
      const existingSubject = existingOutputSubjects.get(key);
      if (existingSubject) {
        this.outputSubjects.set(key, existingSubject);
      } else {
        const subject = new Subject<FuncDefSignal>();
        this.outputSubjects.set(key, subject);
      }
    }

    // Instantiate internal nodes from graphData
    this.instantiateInternalNodes();

    // Rebuild internal pipeline to wire up the internal nodes with existing inputs
    this.rebuildInternalPipeline();

    // Notify graph to re-render
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  // Instantiate internal nodes from function definition's graphData
  private instantiateInternalNodes(): void {
    if (!this.functionDef?.graphData) return;

    const nodes = this.functionDef.graphData.nodes as NodeData[];

    for (const nodeData of nodes) {
      const { id, type, data } = nodeData;

      // Track FuncDefIn/FuncDefOut nodes (they define the interface, not instantiated)
      if (type === 'FuncDefIn') {
        this.funcDefInId = id;
        continue;
      }
      if (type === 'FuncDefOut') {
        this.funcDefOutId = id;
        continue;
      }

      // Create internal node instances based on type
      let internalNode: InternalNode | null = null;

      switch (type) {
        case 'If':
          internalNode = new IfNode();
          if (data) {
            // Deserialize If node data
            (internalNode as IfNode).deserialize(data as { comparisonType: IfComparisonType; operator: ComparisonOperator });
          }
          break;
        case 'Constant':
          internalNode = new ConstantNode();
          if (data) {
            // Deserialize Constant node data
            (internalNode as ConstantNode).deserialize(data as { constantType: ConstantType; rawValue: string });
          }
          break;
        case 'Count':
          internalNode = new CountNode();
          break;
        case 'Extraction':
          internalNode = new ExtractionNode();
          if (data) {
            // Deserialize Extraction node data
            (internalNode as ExtractionNode).deserialize(data as { extractionField: ExtractionField; relayFilterType: RelayFilterType });
          }
          break;
        default:
          // Unsupported node type in function - skip
          console.warn(`[FunctionNode] Unsupported internal node type: ${type}`);
          continue;
      }

      if (internalNode) {
        this.internalNodes.set(id, internalNode);
      }
    }
  }

  // Set input observable (called during pipeline wiring)
  setInput(socketKey: string, input$: Observable<FuncDefSignal> | null): void {
    this.inputs$.set(socketKey, input$);
    this.rebuildInternalPipeline();
  }

  // Rebuild internal pipeline - wire internal nodes according to graphData.connections
  private rebuildInternalPipeline(): void {
    // Stop existing subscriptions
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    if (!this.functionDef?.graphData) {
      return;
    }

    const connections = this.functionDef.graphData.connections as ConnectionData[];

    // Helper to get observable from source node/socket
    const getSourceObservable = (sourceId: string, sourceOutput: string): Observable<FuncDefSignal> | null => {
      // If source is FuncDefIn, use FunctionNode's input
      if (sourceId === this.funcDefInId) {
        // Map FuncDefIn output (out_0, out_1, ...) to FunctionNode input (in_0, in_1, ...)
        const inputKey = sourceOutput.replace('out_', 'in_');
        return this.inputs$.get(inputKey) || null;
      }

      // Otherwise, get from internal node
      const internalNode = this.internalNodes.get(sourceId);
      if (!internalNode) return null;

      // Get output observable based on node type
      if (internalNode instanceof IfNode) {
        return internalNode.output$ as Observable<FuncDefSignal>;
      } else if (internalNode instanceof ConstantNode) {
        return internalNode.output$ as Observable<FuncDefSignal>;
      } else if (internalNode instanceof CountNode) {
        return internalNode.output$ as Observable<FuncDefSignal>;
      } else if (internalNode instanceof ExtractionNode) {
        return internalNode.getOutput$() as Observable<FuncDefSignal>;
      }

      return null;
    };

    // Wire internal nodes
    for (const conn of connections) {
      const { source, sourceOutput, target, targetInput } = conn;

      // Get source observable
      const source$ = getSourceObservable(source, sourceOutput);
      if (!source$) continue;

      // If target is FuncDefOut, wire to FunctionNode's output
      if (target === this.funcDefOutId) {
        // Map FuncDefOut input (in_0, in_1, ...) to FunctionNode output (out_0, out_1, ...)
        const outputKey = targetInput.replace('in_', 'out_');
        const outputSubject = this.outputSubjects.get(outputKey);
        if (outputSubject) {
          const sub = source$.subscribe({
            next: (signal) => outputSubject.next(signal),
          });
          this.subscriptions.push(sub);
        }
        continue;
      }

      // Wire to internal node
      const targetNode = this.internalNodes.get(target);
      if (!targetNode) continue;

      // Set input based on node type and socket
      if (targetNode instanceof IfNode) {
        if (targetInput === 'inputA') {
          targetNode.setInputA(source$);
        } else if (targetInput === 'inputB') {
          targetNode.setInputB(source$);
        }
      } else if (targetNode instanceof CountNode) {
        targetNode.setInput(source$);
      } else if (targetNode instanceof ExtractionNode) {
        // ExtractionNode expects EventSignal, cast if needed
        targetNode.setInput(source$ as Observable<import('../../../nostr/types').EventSignal>);
      }
      // ConstantNode has no inputs, it only outputs
    }
  }

  // Get output observable (used by downstream nodes)
  getOutput$(socketKey: string): Observable<FuncDefSignal> | null {
    const subject = this.outputSubjects.get(socketKey);
    return subject ? subject.asObservable() : null;
  }

  // Get output observable by index
  getOutputByIndex$(index: number): Observable<FuncDefSignal> | null {
    return this.getOutput$(`out_${index}`);
  }

  // Emit to output (called by internal wiring)
  emitToOutput(socketKey: string, signal: FuncDefSignal): void {
    const subject = this.outputSubjects.get(socketKey);
    if (subject) {
      subject.next(signal);
    }
  }

  // Get function path
  getFunctionPath(): string {
    return this.functionPath;
  }

  // Get function definition
  getFunctionDefinition(): FunctionDefinition | null {
    return this.functionDef;
  }

  // Get all input keys
  getInputKeys(): string[] {
    return Array.from(this.inputs$.keys());
  }

  // Get input observable by key
  getInput$(key: string): Observable<FuncDefSignal> | null {
    return this.inputs$.get(key) || null;
  }

  // Get status
  getStatus(): StatusLampState {
    return this.status;
  }

  // Get internal wiring info for dumpobs()
  getInternalWiringInfo(): { nodes: string[]; connections: string[] } {
    const nodes: string[] = [];
    const connections: string[] = [];

    if (!this.functionDef?.graphData) {
      return { nodes, connections };
    }

    const graphNodes = this.functionDef.graphData.nodes as NodeData[];
    const graphConns = this.functionDef.graphData.connections as ConnectionData[];

    // List internal nodes
    for (const nodeData of graphNodes) {
      if (nodeData.type === 'FuncDefIn' || nodeData.type === 'FuncDefOut') {
        continue; // Skip interface nodes
      }
      nodes.push(`${nodeData.type}:${nodeData.id.slice(0, 8)}`);
    }

    // List connections with proper labels
    for (const conn of graphConns) {
      let sourceLabel: string;
      let targetLabel: string;

      // Source label
      if (conn.source === this.funcDefInId) {
        sourceLabel = `FunctionNode.${conn.sourceOutput.replace('out_', 'in_')}`;
      } else {
        const sourceNode = graphNodes.find(n => n.id === conn.source);
        sourceLabel = sourceNode ? `${sourceNode.type}:${conn.source.slice(0, 8)}.${conn.sourceOutput}` : `?:${conn.source.slice(0, 8)}.${conn.sourceOutput}`;
      }

      // Target label
      if (conn.target === this.funcDefOutId) {
        targetLabel = `FunctionNode.${conn.targetInput.replace('in_', 'out_')}`;
      } else {
        const targetNode = graphNodes.find(n => n.id === conn.target);
        targetLabel = targetNode ? `${targetNode.type}:${conn.target.slice(0, 8)}.${conn.targetInput}` : `?:${conn.target.slice(0, 8)}.${conn.targetInput}`;
      }

      connections.push(`${sourceLabel} -> ${targetLabel}`);
    }

    return { nodes, connections };
  }

  serialize() {
    // Serialize socket definitions so they can be restored before connections
    const inputSockets: SocketDefinition[] = [];
    const outputSockets: SocketDefinition[] = [];

    if (this.functionDef) {
      inputSockets.push(...this.functionDef.inputSockets);
      outputSockets.push(...this.functionDef.outputSockets);
    }

    return {
      functionPath: this.functionPath,
      inputSockets,
      outputSockets,
    };
  }

  deserialize(data: { functionPath: string; inputSockets?: SocketDefinition[]; outputSockets?: SocketDefinition[] }) {
    this.functionPath = data.functionPath;

    // Update path control
    const pathControl = this.controls['path'] as TextInputControl;
    if (pathControl) {
      pathControl.value = this.functionPath;
    }

    // Restore sockets immediately from saved definitions (so connections can be restored)
    if (data.inputSockets && data.inputSockets.length > 0 &&
        data.outputSockets && data.outputSockets.length > 0) {
      // Create a temporary function definition to restore sockets
      this.functionDef = {
        path: this.functionPath,
        pubkey: '',
        graphData: { version: 1, nodes: [], connections: [] },
        inputSockets: data.inputSockets,
        outputSockets: data.outputSockets,
      };
      this.updateSocketsFromDefinition();
      this.setStatus('working', 'working');
    }
  }

  // Stop all internal subscriptions (but keep outputSubjects alive for downstream subscribers)
  stopSubscription(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    // NOTE: Do NOT complete outputSubjects here!
    // They will be reused when rebuildInternalPipeline is called again.
    // Downstream nodes (like TimelineNode) may be subscribed to them.
  }

  // Complete all subscriptions and subjects (for cleanup when node is deleted)
  dispose(): void {
    this.stopSubscription();
    for (const subject of this.outputSubjects.values()) {
      subject.complete();
    }
    this.outputSubjects.clear();
  }
}
