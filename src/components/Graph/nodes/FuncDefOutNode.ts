import { ClassicPreset } from 'rete';
import { Subject, Observable, Subscription } from 'rxjs';
import i18next from 'i18next';
import { anySocket, getSocketByType } from './types';
import { SocketListControl, type SocketDefinition, type FuncDefSignal } from './FuncDefInNode';

export class FuncDefOutNode extends ClassicPreset.Node {
  static readonly nodeType = 'FuncDefOut';
  readonly nodeType = 'FuncDefOut';
  width = 200;
  height: number | undefined = undefined;

  private socketList: SocketDefinition[] = [{ name: 'out 0', type: 'Any' }];

  // Input observables for each socket
  private inputs$: Map<string, Observable<FuncDefSignal> | null> = new Map();

  // Subscriptions for internal pipeline
  private subscriptions: Map<string, Subscription> = new Map();

  // Output subjects - expose signals received on inputs to the FunctionNode
  private outputSubjects: Map<string, Subject<FuncDefSignal>> = new Map();

  constructor() {
    super(i18next.t('nodes.funcDefOut.title', 'Function Output'));

    // Add socket list control
    this.addControl(
      'socketList',
      new SocketListControl(
        this.socketList,
        i18next.t('nodes.funcDefOut.sockets', 'Input Sockets'),
        (sockets) => {
          this.socketList = sockets;
          this.updateInputSockets();
          // Notify graph to re-render the node
          window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
        }
      )
    );

    // Initialize with default socket
    this.updateInputSockets();
  }

  private updateInputSockets(): void {
    // Stop existing subscriptions
    this.stopSubscription();

    // Remove all existing inputs
    for (const key of Object.keys(this.inputs)) {
      this.removeInput(key);
      this.inputs$.delete(key);
    }

    // Add inputs based on socket list
    for (let i = 0; i < this.socketList.length; i++) {
      const def = this.socketList[i];
      const key = `in_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addInput(key, new ClassicPreset.Input(socket, def.name));

      // Initialize input observable as null
      this.inputs$.set(key, null);

      // Create subject for this output
      const subject = new Subject<FuncDefSignal>();
      this.outputSubjects.set(key, subject);
    }
  }

  // Set input observable for a specific socket (called during pipeline wiring)
  setInput(socketKey: string, input$: Observable<FuncDefSignal> | null): void {
    this.inputs$.set(socketKey, input$);
    this.rebuildPipelineForSocket(socketKey);
  }

  // Set input by index
  setInputByIndex(index: number, input$: Observable<FuncDefSignal> | null): void {
    this.setInput(`in_${index}`, input$);
  }

  private rebuildPipelineForSocket(socketKey: string): void {
    // Stop existing subscription for this socket
    const existingSub = this.subscriptions.get(socketKey);
    if (existingSub) {
      existingSub.unsubscribe();
      this.subscriptions.delete(socketKey);
    }

    const input$ = this.inputs$.get(socketKey);
    const outputSubject = this.outputSubjects.get(socketKey);

    if (!input$ || !outputSubject) return;

    // Subscribe and forward to output subject
    const subscription = input$.subscribe({
      next: (signal) => outputSubject.next(signal),
    });
    this.subscriptions.set(socketKey, subscription);
  }

  // Get output observable for a specific socket (used by FunctionNode)
  getOutput$(socketKey: string): Observable<FuncDefSignal> | null {
    // Map input key to output key
    const outputKey = socketKey.replace('in_', 'in_'); // Same key
    const subject = this.outputSubjects.get(outputKey);
    return subject ? subject.asObservable() : null;
  }

  // Get output observable by index
  getOutputByIndex$(index: number): Observable<FuncDefSignal> | null {
    const subject = this.outputSubjects.get(`in_${index}`);
    return subject ? subject.asObservable() : null;
  }

  // Get socket list for external access
  getSocketList(): SocketDefinition[] {
    return [...this.socketList];
  }

  // Get socket count
  getSocketCount(): number {
    return this.socketList.length;
  }

  serialize() {
    return {
      socketList: this.socketList,
    };
  }

  deserialize(data: { socketList: SocketDefinition[] }) {
    this.socketList = data.socketList;

    // Update control
    const control = this.controls['socketList'] as SocketListControl;
    if (control) {
      control.sockets = this.socketList;
    }

    // Update input sockets
    this.updateInputSockets();
  }

  // Clean up on node removal
  stopSubscription(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();

    for (const subject of this.outputSubjects.values()) {
      subject.complete();
    }
  }
}
