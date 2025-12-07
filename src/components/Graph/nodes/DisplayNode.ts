import { ClassicPreset } from 'rete';
import { eventSocket } from './types';
import { TextInputControl } from './controls';

export class DisplayNode extends ClassicPreset.Node {
  width = 180;
  height = 120;

  private timelineName: string = 'Timeline';

  constructor() {
    super('Display');

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Events'));

    this.addControl(
      'name',
      new TextInputControl(
        this.timelineName,
        'Timeline Name',
        (value) => {
          this.timelineName = value;
        }
      )
    );
  }

  getTimelineName(): string {
    return this.timelineName;
  }

  serialize() {
    return {
      timelineName: this.timelineName,
    };
  }

  deserialize(data: { timelineName: string }) {
    this.timelineName = data.timelineName;

    const control = this.controls['name'] as TextInputControl;
    if (control) {
      control.value = this.timelineName;
    }
  }
}
