import { ClassicPreset } from 'rete';
import { Subject, Observable } from 'rxjs';
import i18next from 'i18next';
import { anySocket, socketMap, getSocketByType } from './types';

// Socket definition for function parameters
export interface SocketDefinition {
  name: string;
  type: string; // Socket type name (Event, Pubkey, etc.)
}

// Control for managing socket list
export class SocketListControl extends ClassicPreset.Control {
  sockets: SocketDefinition[];
  label: string;
  onChange: (sockets: SocketDefinition[]) => void;

  constructor(
    sockets: SocketDefinition[],
    label: string,
    onChange: (sockets: SocketDefinition[]) => void
  ) {
    super();
    this.sockets = sockets;
    this.label = label;
    this.onChange = onChange;
  }
}

// Available socket types for selection
export const SOCKET_TYPES = Object.keys(socketMap).map(key => ({
  value: key,
  label: key,
}));

// Signal type for func-def nodes (generic, can carry any data)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FuncDefSignal = any;

export class FuncDefInNode extends ClassicPreset.Node {
  static readonly nodeType = 'FuncDefIn';
  readonly nodeType = 'FuncDefIn';
  width = 200;
  height: number | undefined = undefined;

  private socketList: SocketDefinition[] = [{ name: 'in 0', type: 'Any' }];

  // Output subjects for each socket - signals received from function node inputs
  private outputSubjects: Map<string, Subject<FuncDefSignal>> = new Map();

  constructor() {
    super(i18next.t('nodes.funcDefIn.title', 'Function Input'));

    // Add socket list control
    this.addControl(
      'socketList',
      new SocketListControl(
        this.socketList,
        i18next.t('nodes.funcDefIn.sockets', 'Output Sockets'),
        (sockets) => {
          this.socketList = sockets;
          this.updateOutputSockets();
          // Notify graph to re-render the node
          window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
        }
      )
    );

    // Initialize with default socket
    this.updateOutputSockets();
  }

  private updateOutputSockets(): void {
    // Remove all existing outputs
    for (const key of Object.keys(this.outputs)) {
      this.removeOutput(key);
      this.outputSubjects.delete(key);
    }

    // Add outputs based on socket list
    for (let i = 0; i < this.socketList.length; i++) {
      const def = this.socketList[i];
      const key = `out_${i}`;
      const socket = getSocketByType(def.type) || anySocket;
      this.addOutput(key, new ClassicPreset.Output(socket, def.name));

      // Create subject for this output
      const subject = new Subject<FuncDefSignal>();
      this.outputSubjects.set(key, subject);
    }
  }

  // Get output observable for a specific socket
  getOutput$(socketKey: string): Observable<FuncDefSignal> | null {
    const subject = this.outputSubjects.get(socketKey);
    return subject ? subject.asObservable() : null;
  }

  // Get output observable by index
  getOutputByIndex$(index: number): Observable<FuncDefSignal> | null {
    return this.getOutput$(`out_${index}`);
  }

  // Emit a signal to a specific output (called by FunctionNode when wiring)
  emitToOutput(socketKey: string, signal: FuncDefSignal): void {
    const subject = this.outputSubjects.get(socketKey);
    if (subject) {
      subject.next(signal);
    }
  }

  // Emit to output by index
  emitToOutputByIndex(index: number, signal: FuncDefSignal): void {
    this.emitToOutput(`out_${index}`, signal);
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

    // Update output sockets
    this.updateOutputSockets();
  }

  // Clean up on node removal
  stopSubscription(): void {
    for (const subject of this.outputSubjects.values()) {
      subject.complete();
    }
    this.outputSubjects.clear();
  }
}
