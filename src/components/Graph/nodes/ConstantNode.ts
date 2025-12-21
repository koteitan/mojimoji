import { ClassicPreset } from 'rete';
import { ReplaySubject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import {
  eventIdSocket,
  pubkeySocket,
  relaySocket,
  flagSocket,
  integerSocket,
  datetimeSocket,
  relayStatusSocket,
} from './types';
import type { RelayStatusType } from './types';
import { SelectControl, TextInputControl, TextAreaControl } from './controls';

// Constant value types
export type ConstantType = 'integer' | 'datetime' | 'eventId' | 'pubkey' | 'relay' | 'flag' | 'relayStatus';

// Value types for each constant type
export type ConstantValue = number | string | string[] | boolean | RelayStatusType;

// Signal type for constant output
export interface ConstantSignal {
  type: ConstantType;
  value: ConstantValue;
}

// Get socket for constant type
function getSocketForType(type: ConstantType): ClassicPreset.Socket {
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

// Get default value for constant type
function getDefaultValue(type: ConstantType): string {
  switch (type) {
    case 'integer': return '0';
    case 'datetime': return new Date().toISOString();
    case 'flag': return '1';
    case 'relayStatus': return 'EOSE';
    case 'relay': return 'wss://yabu.me\nwss://relay.damus.io';
    default: return '';
  }
}

// Get placeholder for constant type
function getPlaceholder(type: ConstantType): string {
  switch (type) {
    case 'integer': return '0';
    case 'datetime': return '2024-01-01T00:00:00Z';
    case 'eventId': return 'nevent1... or hex';
    case 'pubkey': return 'npub1... or hex';
    case 'relay': return 'wss://relay.example.com';
    default: return '';
  }
}

export class ConstantNode extends ClassicPreset.Node {
  static readonly nodeType = 'Constant';
  readonly nodeType = 'Constant';
  width = 200;
  height: number | undefined = undefined;

  private constantType: ConstantType = 'integer';
  private rawValue: string = getDefaultValue('integer');

  // Output observable - use ReplaySubject(1) so late subscribers get the last value
  private outputSubject = new ReplaySubject<ConstantSignal>(1);
  public output$: Observable<ConstantSignal> = this.outputSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.constant.title', 'Constant'));

    this.addOutput('output', new ClassicPreset.Output(integerSocket, 'Value'));

    // Type selector
    this.addControl(
      'type',
      new SelectControl(
        this.constantType,
        i18next.t('nodes.constant.type', 'Type'),
        [
          { value: 'integer', label: i18next.t('nodes.constant.integer', 'Integer') },
          { value: 'datetime', label: i18next.t('nodes.constant.datetime', 'Datetime') },
          { value: 'eventId', label: i18next.t('nodes.constant.eventId', 'Event ID') },
          { value: 'pubkey', label: i18next.t('nodes.constant.pubkey', 'Pubkey') },
          { value: 'relay', label: i18next.t('nodes.constant.relay', 'Relay') },
          { value: 'flag', label: i18next.t('nodes.constant.flag', 'Flag') },
          { value: 'relayStatus', label: i18next.t('nodes.constant.relayStatus', 'Relay Status') },
        ],
        (value) => {
          this.constantType = value as ConstantType;
          this.rawValue = getDefaultValue(this.constantType);
          this.updateOutputSocket();
          this.updateValueControl();
          this.emitValue();
          // Notify graph to re-render the node with new control
          window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
        }
      )
    );

    // Value input (default: text input for integer)
    this.addControl(
      'value',
      new TextInputControl(
        this.rawValue,
        i18next.t('nodes.constant.value', 'Value'),
        (value) => {
          this.rawValue = value;
          this.emitValue();
        },
        false
      )
    );

    // Emit initial value
    this.emitValue();
  }

  private updateOutputSocket(): void {
    // Remove existing output and add new one with correct socket type
    this.removeOutput('output');
    this.addOutput('output', new ClassicPreset.Output(getSocketForType(this.constantType), 'Value'));
  }

  private updateValueControl(): void {
    // Remove existing value control
    this.removeControl('value');

    // Add appropriate control based on type
    switch (this.constantType) {
      case 'relay':
        // Textarea for relay (multiple URLs)
        this.addControl(
          'value',
          new TextAreaControl(
            this.rawValue,
            i18next.t('nodes.constant.value', 'Value'),
            getPlaceholder('relay'),
            (value) => {
              this.rawValue = value;
              this.emitValue();
            }
          )
        );
        break;

      case 'relayStatus':
        // Dropdown for relay status
        this.addControl(
          'value',
          new SelectControl(
            this.rawValue || getDefaultValue('relayStatus'),
            i18next.t('nodes.constant.value', 'Value'),
            [
              { value: 'idle', label: 'idle' },
              { value: 'connecting', label: 'connecting' },
              { value: 'sub-stored', label: 'sub-stored' },
              { value: 'EOSE', label: 'EOSE' },
              { value: 'sub-realtime', label: 'sub-realtime' },
              { value: 'closed', label: 'closed' },
              { value: 'error', label: 'error' },
            ],
            (value) => {
              this.rawValue = value;
              this.emitValue();
            }
          )
        );
        break;

      case 'flag':
        // Dropdown for flag (0 or 1)
        this.addControl(
          'value',
          new SelectControl(
            this.rawValue || getDefaultValue('flag'),
            i18next.t('nodes.constant.value', 'Value'),
            [
              { value: '0', label: '0 (false)' },
              { value: '1', label: '1 (true)' },
            ],
            (value) => {
              this.rawValue = value;
              this.emitValue();
            }
          )
        );
        break;

      default:
        // Text input for integer, datetime, eventId, pubkey
        this.addControl(
          'value',
          new TextInputControl(
            this.rawValue,
            i18next.t('nodes.constant.value', 'Value'),
            (value) => {
              this.rawValue = value;
              this.emitValue();
            },
            false,
            getPlaceholder(this.constantType)
          )
        );
        break;
    }
  }

  private parseValue(): ConstantValue {
    switch (this.constantType) {
      case 'integer':
        return parseInt(this.rawValue, 10) || 0;

      case 'datetime':
        // Return as timestamp (seconds since epoch)
        const date = new Date(this.rawValue);
        if (!isNaN(date.getTime())) {
          return Math.floor(date.getTime() / 1000);
        }
        // Try parsing as unix timestamp
        const timestamp = parseInt(this.rawValue, 10);
        return isNaN(timestamp) ? 0 : timestamp;

      case 'eventId':
      case 'pubkey':
        // Return as-is (hex or bech32)
        return this.rawValue.trim();

      case 'relay':
        // Return as array of URLs
        return this.rawValue.split('\n').filter(url => url.trim()).map(url => url.trim());

      case 'flag':
        return this.rawValue === '1';

      case 'relayStatus':
        return (this.rawValue || 'idle') as RelayStatusType;
    }
  }

  emitValue(): void {
    const value = this.parseValue();
    this.outputSubject.next({
      type: this.constantType,
      value,
    });
  }

  getConstantType(): ConstantType {
    return this.constantType;
  }

  getValue(): ConstantValue {
    return this.parseValue();
  }

  serialize() {
    return {
      constantType: this.constantType,
      rawValue: this.rawValue,
    };
  }

  deserialize(data: { constantType: ConstantType; rawValue: string }) {
    this.constantType = data.constantType;
    this.rawValue = data.rawValue;

    // Update type control
    const typeControl = this.controls['type'] as SelectControl;
    if (typeControl) {
      typeControl.value = this.constantType;
    }

    // Update output socket and value control
    this.updateOutputSocket();
    this.updateValueControl();

    // Emit the restored value
    this.emitValue();
  }
}
