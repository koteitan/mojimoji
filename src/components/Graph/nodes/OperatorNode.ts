import { ClassicPreset } from 'rete';
import { eventSocket } from './types';
import { SelectControl } from './controls';

export type OperatorType = 'AND' | 'OR' | 'A-B';

export class OperatorNode extends ClassicPreset.Node {
  width = 180;
  height = 160;

  private operator: OperatorType = 'AND';

  constructor() {
    super('Operator');

    this.addInput('input1', new ClassicPreset.Input(eventSocket, 'Input A'));
    this.addInput('input2', new ClassicPreset.Input(eventSocket, 'Input B'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    this.addControl(
      'operator',
      new SelectControl(
        this.operator,
        'Operation',
        [
          { value: 'AND', label: 'AND (A ∩ B)' },
          { value: 'OR', label: 'OR (A ∪ B)' },
          { value: 'A-B', label: 'A - B' },
        ],
        (value) => {
          this.operator = value as OperatorType;
        }
      )
    );
  }

  getOperator(): OperatorType {
    return this.operator;
  }

  serialize() {
    return {
      operator: this.operator,
    };
  }

  deserialize(data: { operator: OperatorType }) {
    this.operator = data.operator;

    const control = this.controls['operator'] as SelectControl;
    if (control) {
      control.value = this.operator;
    }
  }
}
