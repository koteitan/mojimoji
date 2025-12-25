import { ClassicPreset } from 'rete';
import { Subject, Observable, shareReplay } from 'rxjs';
import i18next from 'i18next';
import {
  integerSocket,
  datetimeSocket,
  flagSocket,
  eventIdSocket,
  pubkeySocket,
  relaySocket,
  relayStatusSocket,
} from './types';
import { SelectControl } from './controls';

// Comparison types
export type IfComparisonType = 'integer' | 'datetime' | 'eventId' | 'pubkey' | 'relay' | 'flag' | 'relayStatus';

// Comparison operators
export type ComparisonOperator = 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';

// Operators for numeric types (integer, datetime)
const numericOperators = [
  { value: 'equal', label: '=' },
  { value: 'notEqual', label: '≠' },
  { value: 'lessThan', label: '<' },
  { value: 'lessThanOrEqual', label: '≤' },
  { value: 'greaterThan', label: '>' },
  { value: 'greaterThanOrEqual', label: '≥' },
];

// Operators for equality-only types (eventId, pubkey, relay, flag, relayStatus)
const equalityOperators = [
  { value: 'equal', label: '=' },
  { value: 'notEqual', label: '≠' },
];

// Output signal type
export interface FlagSignal {
  flag: boolean;
}

// Get socket for comparison type
function getSocketForType(type: IfComparisonType): ClassicPreset.Socket {
  switch (type) {
    case 'integer': return integerSocket;
    case 'datetime': return datetimeSocket;
    case 'eventId': return eventIdSocket;
    case 'pubkey': return pubkeySocket;
    case 'relay': return relaySocket;
    case 'flag': return flagSocket;
    case 'relayStatus': return relayStatusSocket;
  }
}

// Check if type supports ordering operators
function supportsOrdering(type: IfComparisonType): boolean {
  return type === 'integer' || type === 'datetime';
}

export class IfNode extends ClassicPreset.Node {
  static readonly nodeType = 'If';
  readonly nodeType = 'If';
  width = 180;
  height: number | undefined = undefined;

  private comparisonType: IfComparisonType = 'integer';
  private operator: ComparisonOperator = 'equal';

  // Input observables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inputA$: Observable<any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inputB$: Observable<any> | null = null;
  private subscriptions: { unsubscribe: () => void }[] = [];

  // Current values (can be number, string, boolean, or string[])
  private valueA: unknown = null;
  private valueB: unknown = null;

  // Output observable
  private outputSubject = new Subject<FlagSignal>();
  public output$: Observable<FlagSignal> = this.outputSubject.asObservable().pipe(shareReplay(1));

  constructor() {
    super(i18next.t('nodes.if.title', 'If'));

    // Default to integer sockets
    this.addInput('inputA', new ClassicPreset.Input(integerSocket, 'A'));
    this.addInput('inputB', new ClassicPreset.Input(integerSocket, 'B'));
    this.addOutput('output', new ClassicPreset.Output(flagSocket, 'Result'));

    // Emit default false value
    this.outputSubject.next({ flag: false });

    // Type selector
    this.addControl(
      'type',
      new SelectControl(
        this.comparisonType,
        i18next.t('nodes.if.type', 'Type'),
        [
          { value: 'integer', label: i18next.t('nodes.if.integer', 'Integer') },
          { value: 'datetime', label: i18next.t('nodes.if.datetime', 'Datetime') },
          { value: 'eventId', label: i18next.t('nodes.if.eventId', 'Event ID') },
          { value: 'pubkey', label: i18next.t('nodes.if.pubkey', 'Pubkey') },
          { value: 'relay', label: i18next.t('nodes.if.relay', 'Relay') },
          { value: 'flag', label: i18next.t('nodes.if.flag', 'Flag') },
          { value: 'relayStatus', label: i18next.t('nodes.if.relayStatus', 'Relay Status') },
        ],
        (value) => {
          const newType = value as IfComparisonType;
          const oldSupportsOrdering = supportsOrdering(this.comparisonType);
          const newSupportsOrdering = supportsOrdering(newType);

          this.comparisonType = newType;
          this.updateInputSockets();

          // If switching from ordering type to equality-only type, reset operator
          if (oldSupportsOrdering && !newSupportsOrdering) {
            if (this.operator !== 'equal' && this.operator !== 'notEqual') {
              this.operator = 'equal';
              const operatorControl = this.controls['operator'] as SelectControl;
              if (operatorControl) {
                operatorControl.value = this.operator;
              }
            }
          }

          // Update operator options
          this.updateOperatorControl();

          // Clear values and re-evaluate
          this.valueA = null;
          this.valueB = null;
          this.outputSubject.next({ flag: false });

          // Notify graph to re-render
          window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
        }
      )
    );

    // Comparison operator selector
    this.addControl(
      'operator',
      new SelectControl(
        this.operator,
        i18next.t('nodes.if.operator', 'Comparison'),
        numericOperators,
        (value) => {
          this.operator = value as ComparisonOperator;
          this.evaluate();
        }
      )
    );
  }

  private updateOperatorControl(): void {
    const operatorControl = this.controls['operator'] as SelectControl;
    if (operatorControl) {
      operatorControl.options = supportsOrdering(this.comparisonType) ? numericOperators : equalityOperators;
    }
  }

  private updateInputSockets(): void {
    // Remove existing input sockets
    this.removeInput('inputA');
    this.removeInput('inputB');

    // Add new sockets based on type
    const socket = getSocketForType(this.comparisonType);
    this.addInput('inputA', new ClassicPreset.Input(socket, 'A'));
    this.addInput('inputB', new ClassicPreset.Input(socket, 'B'));
  }

  getComparisonType(): IfComparisonType {
    return this.comparisonType;
  }

  getOperator(): ComparisonOperator {
    return this.operator;
  }

  // Set input observables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setInputA(input: Observable<any> | null): void {
    this.inputA$ = input;
    this.rebuildPipeline();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setInputB(input: Observable<any> | null): void {
    this.inputB$ = input;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    // Cleanup existing subscriptions
    this.stopSubscriptions();
    this.valueA = null;
    this.valueB = null;

    if (this.inputA$) {
      const sub = this.inputA$.subscribe({
        next: (signal) => {
          this.valueA = this.extractValue(signal);
          this.evaluate();
        },
      });
      this.subscriptions.push(sub);
    }

    if (this.inputB$) {
      const sub = this.inputB$.subscribe({
        next: (signal) => {
          this.valueB = this.extractValue(signal);
          this.evaluate();
        },
      });
      this.subscriptions.push(sub);
    }
  }

  // Extract value from signal based on comparison type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractValue(signal: any): unknown {
    if (signal === null || signal === undefined) return null;

    switch (this.comparisonType) {
      case 'integer':
      case 'datetime':
        // Number value
        return signal.value ?? signal.datetime ?? signal;
      case 'eventId':
        // String value
        return signal.value ?? signal.eventId ?? signal;
      case 'pubkey':
        // String value
        return signal.value ?? signal.pubkey ?? signal;
      case 'relay':
        // Array of strings - convert to sorted string for comparison
        const relays = signal.value ?? signal.relays ?? signal;
        if (Array.isArray(relays)) {
          return [...relays].sort().join('\n');
        }
        return relays;
      case 'flag':
        // Boolean value
        return signal.value ?? signal.flag ?? signal;
      case 'relayStatus':
        // String value
        return signal.value ?? signal.status ?? signal;
      default:
        return signal.value ?? signal;
    }
  }

  private evaluate(): void {
    if (this.valueA === null || this.valueB === null) {
      return;
    }

    let result = false;

    // For ordering operators, only allow on numeric types
    if (!supportsOrdering(this.comparisonType) &&
        this.operator !== 'equal' && this.operator !== 'notEqual') {
      // Invalid operator for this type, default to false
      this.outputSubject.next({ flag: false });
      return;
    }

    switch (this.operator) {
      case 'equal':
        result = this.valueA === this.valueB;
        break;
      case 'notEqual':
        result = this.valueA !== this.valueB;
        break;
      case 'greaterThan':
        result = (this.valueA as number) > (this.valueB as number);
        break;
      case 'lessThan':
        result = (this.valueA as number) < (this.valueB as number);
        break;
      case 'greaterThanOrEqual':
        result = (this.valueA as number) >= (this.valueB as number);
        break;
      case 'lessThanOrEqual':
        result = (this.valueA as number) <= (this.valueB as number);
        break;
    }

    this.outputSubject.next({ flag: result });
  }

  stopSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  serialize() {
    return {
      comparisonType: this.comparisonType,
      operator: this.operator,
    };
  }

  deserialize(data: { comparisonType: IfComparisonType; operator: ComparisonOperator }) {
    this.comparisonType = data.comparisonType || 'integer';
    this.operator = data.operator || 'equal';

    // Validate operator for non-ordering types
    if (!supportsOrdering(this.comparisonType) &&
        this.operator !== 'equal' && this.operator !== 'notEqual') {
      this.operator = 'equal';
    }

    // Update controls
    const typeControl = this.controls['type'] as SelectControl;
    if (typeControl) {
      typeControl.value = this.comparisonType;
    }

    const operatorControl = this.controls['operator'] as SelectControl;
    if (operatorControl) {
      operatorControl.value = this.operator;
      operatorControl.options = supportsOrdering(this.comparisonType) ? numericOperators : equalityOperators;
    }

    // Update input sockets
    this.updateInputSockets();
  }
}
