import { ClassicPreset } from 'rete';
import { eventSocket } from './types';
import { TextAreaControl } from './controls';

export class SourceNode extends ClassicPreset.Node {
  width = 220;
  height = 200;

  private relayUrls: string[] = ['wss://relay.damus.io'];
  private filterJson: string = '{"kinds": [1], "limit": 20}';

  constructor() {
    super('Source');

    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));

    this.addControl(
      'relays',
      new TextAreaControl(
        this.relayUrls.join('\n'),
        'Relay URLs',
        'wss://relay.example.com',
        (value) => {
          this.relayUrls = value.split('\n').filter(url => url.trim());
        }
      )
    );

    this.addControl(
      'filter',
      new TextAreaControl(
        this.filterJson,
        'Filter (JSON)',
        '{"kinds": [1], "limit": 20}',
        (value) => {
          this.filterJson = value;
        }
      )
    );
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  getFilter(): Record<string, unknown> {
    try {
      return JSON.parse(this.filterJson);
    } catch {
      return { kinds: [1], limit: 20 };
    }
  }

  serialize() {
    return {
      relayUrls: this.relayUrls,
      filterJson: this.filterJson,
    };
  }

  deserialize(data: { relayUrls: string[]; filterJson: string }) {
    this.relayUrls = data.relayUrls;
    this.filterJson = data.filterJson;

    const relaysControl = this.controls['relays'] as TextAreaControl;
    if (relaysControl) {
      relaysControl.value = this.relayUrls.join('\n');
    }

    const filterControl = this.controls['filter'] as TextAreaControl;
    if (filterControl) {
      filterControl.value = this.filterJson;
    }
  }
}
