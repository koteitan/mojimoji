import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import {
  integerSocket,
  datetimeSocket,
  flagSocket,
} from './types';
import { SelectControl } from './controls';

// Comparison operators
export type ComparisonOperator = 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';

// Input signal types
export interface NumberSignal {
  value: number;
}

// Output signal type
export interface FlagSignal {
  flag: boolean;
}

export class IfNode extends ClassicPreset.Node {
  static readonly nodeType = 'If';
  readonly nodeType = 'If';
  width = 180;
  height: number | undefined = undefined;

  private comparisonType: 'integer' | 'datetime' = 'integer';
  private operator: ComparisonOperator = 'equal';

  // Input observables
  private inputA$: Observable<NumberSignal> | null = null;
  private inputB$: Observable<NumberSignal> | null = null;
  private subscriptions: { unsubscribe: () => void }[] = [];

  // Current values
  private valueA: number | null = null;
  private valueB: number | null = null;

  // Output observable
  private outputSubject = new Subject<FlagSignal>();
  public output$: Observable<FlagSignal> = this.outputSubject.asObservable().pipe(share());

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
        ],
        (value) => {
          this.comparisonType = value as 'integer' | 'datetime';
          this.updateInputSockets();
        }
      )
    );

    // Comparison operator selector
    this.addControl(
      'operator',
      new SelectControl(
        this.operator,
        i18next.t('nodes.if.operator', 'Comparison'),
        [
          { value: 'equal', label: '=' },
          { value: 'notEqual', label: '≠' },
          { value: 'lessThan', label: '<' },
          { value: 'lessThanOrEqual', label: '≤' },
          { value: 'greaterThan', label: '>' },
          { value: 'greaterThanOrEqual', label: '≥' },
        ],
        (value) => {
          this.operator = value as ComparisonOperator;
          this.evaluate();
        }
      )
    );
  }

  private updateInputSockets(): void {
    // Remove existing input sockets
    this.removeInput('inputA');
    this.removeInput('inputB');

    // Add new sockets based on type
    const socket = this.comparisonType === 'integer' ? integerSocket : datetimeSocket;
    this.addInput('inputA', new ClassicPreset.Input(socket, 'A'));
    this.addInput('inputB', new ClassicPreset.Input(socket, 'B'));
  }

  getComparisonType(): 'integer' | 'datetime' {
    return this.comparisonType;
  }

  getOperator(): ComparisonOperator {
    return this.operator;
  }

  // Set input observables
  setInputA(input: Observable<NumberSignal> | null): void {
    this.inputA$ = input;
    this.rebuildPipeline();
  }

  setInputB(input: Observable<NumberSignal> | null): void {
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
          this.valueA = signal.value;
          this.evaluate();
        },
      });
      this.subscriptions.push(sub);
    }

    if (this.inputB$) {
      const sub = this.inputB$.subscribe({
        next: (signal) => {
          this.valueB = signal.value;
          this.evaluate();
        },
      });
      this.subscriptions.push(sub);
    }
  }

  private evaluate(): void {
    if (this.valueA === null || this.valueB === null) {
      return;
    }

    let result = false;

    switch (this.operator) {
      case 'equal':
        result = this.valueA === this.valueB;
        break;
      case 'notEqual':
        result = this.valueA !== this.valueB;
        break;
      case 'greaterThan':
        result = this.valueA > this.valueB;
        break;
      case 'lessThan':
        result = this.valueA < this.valueB;
        break;
      case 'greaterThanOrEqual':
        result = this.valueA >= this.valueB;
        break;
      case 'lessThanOrEqual':
        result = this.valueA <= this.valueB;
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

  deserialize(data: { comparisonType: 'integer' | 'datetime'; operator: ComparisonOperator }) {
    this.comparisonType = data.comparisonType;
    this.operator = data.operator;

    // Update controls
    const typeControl = this.controls['type'] as SelectControl;
    if (typeControl) {
      typeControl.value = this.comparisonType;
    }

    const operatorControl = this.controls['operator'] as SelectControl;
    if (operatorControl) {
      operatorControl.value = this.operator;
    }

    // Update input sockets
    this.updateInputSockets();
  }
}
