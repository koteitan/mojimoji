import { ClassicPreset } from 'rete';
import { Observable, merge, share, Subject } from 'rxjs';
import i18next from 'i18next';
import {
  eventSocket,
  eventIdSocket,
  pubkeySocket,
  relaySocket,
  flagSocket,
  integerSocket,
  datetimeSocket,
  relayStatusSocket,
} from './types';
import { SelectControl } from './controls';
import type { EventSignal } from '../../../nostr/types';

export type OperatorType = 'AND' | 'OR' | 'A-B';
export type OperatorDataType = 'event' | 'eventId' | 'pubkey' | 'relay' | 'flag' | 'integer' | 'datetime' | 'relayStatus';

// Generic signal type for all data types
export interface GenericSignal {
  value: unknown;
  key: string; // Unique key for AND/A-B operations
  signal: 'add' | 'remove';
}

// Get socket for data type
function getSocketForDataType(dataType: OperatorDataType): ClassicPreset.Socket {
  switch (dataType) {
    case 'event': return eventSocket;
    case 'eventId': return eventIdSocket;
    case 'pubkey': return pubkeySocket;
    case 'relay': return relaySocket;
    case 'flag': return flagSocket;
    case 'integer': return integerSocket;
    case 'datetime': return datetimeSocket;
    case 'relayStatus': return relayStatusSocket;
  }
}

export class OperatorNode extends ClassicPreset.Node {
  static readonly nodeType = 'Operator';
  readonly nodeType = 'Operator';
  width = 180;
  height: number | undefined = undefined; // auto-calculated based on content

  private operator: OperatorType = 'AND';
  private dataType: OperatorDataType = 'event';

  // Input observables (set by GraphEditor when connections change)
  // Using 'unknown' to support all signal types
  private input1$: Observable<unknown> | null = null;
  private input2$: Observable<unknown> | null = null;

  // Output observable (using EventSignal for backward compatibility, but works with all types)
  private outputSubject = new Subject<EventSignal>();
  public output$: Observable<EventSignal> = this.outputSubject.asObservable().pipe(share());

  // Track seen keys for AND operation
  private seenFromInput1 = new Set<string>();
  private seenFromInput2 = new Set<string>();

  // Subscriptions
  private subscriptions: { unsubscribe: () => void }[] = [];

  constructor() {
    super(i18next.t('nodes.operator.title'));

    this.addInput('input1', new ClassicPreset.Input(eventSocket, 'Input A'));
    this.addInput('input2', new ClassicPreset.Input(eventSocket, 'Input B'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    // Data type selector
    this.addControl(
      'dataType',
      new SelectControl(
        this.dataType,
        i18next.t('nodes.operator.dataType', 'Type'),
        [
          { value: 'event', label: 'Event' },
          { value: 'eventId', label: 'Event ID' },
          { value: 'pubkey', label: 'Pubkey' },
          { value: 'relay', label: 'Relay' },
          { value: 'flag', label: 'Flag' },
          { value: 'integer', label: 'Integer' },
          { value: 'datetime', label: 'Datetime' },
          { value: 'relayStatus', label: 'Relay Status' },
        ],
        (value) => {
          this.dataType = value as OperatorDataType;
          this.updateSockets();
        }
      )
    );

    this.addControl(
      'operator',
      new SelectControl(
        this.operator,
        'Operation',
        [
          { value: 'AND', label: i18next.t('nodes.operator.and') + ' (A ∩ B)' },
          { value: 'OR', label: i18next.t('nodes.operator.or') + ' (A ∪ B)' },
          { value: 'A-B', label: i18next.t('nodes.operator.diff') },
        ],
        (value) => {
          this.operator = value as OperatorType;
        }
      )
    );
  }

  private updateSockets(): void {
    // Remove existing sockets
    this.removeInput('input1');
    this.removeInput('input2');
    this.removeOutput('output');

    // Add sockets with the new type
    const socket = getSocketForDataType(this.dataType);
    this.addInput('input1', new ClassicPreset.Input(socket, 'Input A'));
    this.addInput('input2', new ClassicPreset.Input(socket, 'Input B'));
    this.addOutput('output', new ClassicPreset.Output(socket, 'Output'));
  }

  getOperator(): OperatorType {
    return this.operator;
  }

  getDataType(): OperatorDataType {
    return this.dataType;
  }

  serialize() {
    return {
      operator: this.operator,
      dataType: this.dataType,
    };
  }

  deserialize(data: { operator: OperatorType; dataType?: OperatorDataType }) {
    this.operator = data.operator;
    this.dataType = data.dataType || 'event';

    const operatorControl = this.controls['operator'] as SelectControl;
    if (operatorControl) {
      operatorControl.value = this.operator;
    }

    const dataTypeControl = this.controls['dataType'] as SelectControl;
    if (dataTypeControl) {
      dataTypeControl.value = this.dataType;
    }

    // Update sockets
    this.updateSockets();
  }

  // Extract unique key from signal based on data type
  private getKeyFromSignal(signal: unknown): string {
    if (!signal || typeof signal !== 'object') return '';

    switch (this.dataType) {
      case 'event':
        return (signal as EventSignal).event?.id || '';
      case 'eventId':
        return (signal as { eventId: string }).eventId || '';
      case 'pubkey':
        return (signal as { pubkey: string }).pubkey || '';
      case 'relay':
        return JSON.stringify((signal as { relays: string[] }).relays || []);
      case 'flag':
        return String((signal as { flag: boolean }).flag);
      case 'integer':
        return String((signal as { value: number }).value);
      case 'datetime':
        return String((signal as { datetime: number }).datetime);
      case 'relayStatus':
        return (signal as { status: string }).status || '';
      default:
        return '';
    }
  }

  // Get the signal type ('add' or 'remove') from a signal
  private getSignalType(signal: unknown): 'add' | 'remove' {
    if (signal && typeof signal === 'object' && 'signal' in signal) {
      return (signal as { signal: 'add' | 'remove' }).signal;
    }
    return 'add';
  }

  // Create an inverted signal
  private invertSignal(signal: unknown): unknown {
    if (!signal || typeof signal !== 'object') return signal;
    const currentSignal = this.getSignalType(signal);
    return { ...signal as object, signal: currentSignal === 'add' ? 'remove' : 'add' };
  }

  // Set input observables and rebuild the pipeline
  setInputs(input1: Observable<unknown> | null, input2: Observable<unknown> | null): void {
    this.input1$ = input1;
    this.input2$ = input2;
    this.rebuildPipeline();
  }

  // Rebuild the observable pipeline based on current operator
  private rebuildPipeline(): void {
    // Cleanup existing subscriptions
    this.stopSubscriptions();
    this.seenFromInput1.clear();
    this.seenFromInput2.clear();

    if (!this.input1$ && !this.input2$) return;

    switch (this.operator) {
      case 'OR':
        // OR: merge both streams (pass through signals as-is)
        if (this.input1$ && this.input2$) {
          const sub = merge(this.input1$, this.input2$).subscribe({
            next: (signal) => this.outputSubject.next(signal as EventSignal),
          });
          this.subscriptions.push(sub);
        } else if (this.input1$) {
          const sub = this.input1$.subscribe({
            next: (signal) => this.outputSubject.next(signal as EventSignal),
          });
          this.subscriptions.push(sub);
        } else if (this.input2$) {
          const sub = this.input2$.subscribe({
            next: (signal) => this.outputSubject.next(signal as EventSignal),
          });
          this.subscriptions.push(sub);
        }
        break;

      case 'AND':
        // AND: only emit values that appear in both streams
        if (this.input1$ && this.input2$) {
          const sub1 = this.input1$.subscribe({
            next: (signal) => {
              const key = this.getKeyFromSignal(signal);
              if (this.seenFromInput2.has(key)) {
                this.outputSubject.next(signal as EventSignal);
              } else {
                this.seenFromInput1.add(key);
              }
            },
          });
          const sub2 = this.input2$.subscribe({
            next: (signal) => {
              const key = this.getKeyFromSignal(signal);
              if (this.seenFromInput1.has(key)) {
                this.outputSubject.next(signal as EventSignal);
              } else {
                this.seenFromInput2.add(key);
              }
            },
          });
          this.subscriptions.push(sub1, sub2);
        }
        break;

      case 'A-B':
        // A-B: values from A that are NOT in B
        if (this.input1$ && this.input2$) {
          // Pass through values from input1 (A) as-is
          const sub1 = this.input1$.subscribe({
            next: (signal) => this.outputSubject.next(signal as EventSignal),
          });
          // Values from input2 (B) are inverted
          const sub2 = this.input2$.subscribe({
            next: (signal) => {
              this.outputSubject.next(this.invertSignal(signal) as EventSignal);
            },
          });
          this.subscriptions.push(sub1, sub2);
        } else if (this.input1$) {
          // If no input2, just pass through input1
          const sub = this.input1$.subscribe({
            next: (signal) => this.outputSubject.next(signal as EventSignal),
          });
          this.subscriptions.push(sub);
        }
        break;
    }
  }

  // Stop all subscriptions
  stopSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }
}
