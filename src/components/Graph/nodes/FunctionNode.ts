import { ClassicPreset } from 'rete';
import { Subject, Observable, Subscription } from 'rxjs';
import i18next from 'i18next';
import { anySocket, getSocketByType } from './types';
import { TextInputControl, StatusLampControl, type StatusLampState } from './controls';
import type { SocketDefinition, FuncDefSignal } from './FuncDefInNode';
import type { GraphData } from '../../../graph/types';

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
      this.clearSockets();
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
        this.clearSockets();
        return;
      }

      this.functionDef = def;
      this.updateSocketsFromDefinition();
      this.setStatus('working', 'working');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.setStatus('error', message);
      this.clearSockets();
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

  private clearSockets(): void {
    // Stop subscriptions
    this.stopSubscription();

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

    // Stop existing subscriptions
    this.stopSubscription();

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
    for (let i = 0; i < this.functionDef.inputSockets.length; i++) {
      const def = this.functionDef.inputSockets[i];
      const key = `in_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addInput(key, new ClassicPreset.Input(socket, def.name));
      this.inputs$.set(key, null);
    }

    // Add output sockets based on function definition
    for (let i = 0; i < this.functionDef.outputSockets.length; i++) {
      const def = this.functionDef.outputSockets[i];
      const key = `out_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addOutput(key, new ClassicPreset.Output(socket, def.name));

      const subject = new Subject<FuncDefSignal>();
      this.outputSubjects.set(key, subject);
    }

    // Notify graph to re-render
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  // Set input observable (called during pipeline wiring)
  setInput(socketKey: string, input$: Observable<FuncDefSignal> | null): void {
    this.inputs$.set(socketKey, input$);
    this.rebuildInternalPipeline();
  }

  // Rebuild internal pipeline - forward inputs to outputs
  private rebuildInternalPipeline(): void {
    // Stop existing subscriptions
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    // For now, implement a simple pass-through:
    // Each input is forwarded to the corresponding output
    // This is a placeholder until full internal node instantiation is implemented
    for (let i = 0; i < this.inputs$.size; i++) {
      const inputKey = `in_${i}`;
      const outputKey = `out_${i}`;
      const input$ = this.inputs$.get(inputKey);
      const outputSubject = this.outputSubjects.get(outputKey);

      if (input$ && outputSubject) {
        const sub = input$.subscribe({
          next: (signal) => outputSubject.next(signal),
        });
        this.subscriptions.push(sub);
      }
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

  // Stop all subscriptions
  stopSubscription(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    for (const subject of this.outputSubjects.values()) {
      subject.complete();
    }
  }
}
