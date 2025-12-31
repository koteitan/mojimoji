import { ClassicPreset } from 'rete';
import { ReplaySubject, Observable, defer, from } from 'rxjs';
import i18next from 'i18next';
import { getDefaultRelayUrl } from '../../../nostr/graphStorage';
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
import { SelectControl, TextInputControl, TextAreaControl, ToggleControl } from './controls';

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

// Get default value for constant type (synchronous)
function getDefaultValue(type: ConstantType): string {
  switch (type) {
    case 'integer': return '0';
    case 'datetime': return new Date().toISOString();
    case 'flag': return '1';
    case 'relayStatus': return 'EOSE';
    case 'relay': return getDefaultRelayUrl();
    default: return '';
  }
}

// Try to get NIP-07 pubkey (async)
async function tryGetNip07Pubkey(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nostr = (window as any).nostr;
    if (nostr?.getPublicKey) {
      return await nostr.getPublicKey();
    }
  } catch {
    // NIP-07 not available or error
  }
  return '';
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

  // Output observable - use ReplaySubject(1) and shareReplay(1) so late subscribers get the last value
  // Recreated on each emitValue() to allow complete() and re-emission
  private outputSubject = new ReplaySubject<ConstantSignal>(1);
  private _baseOutput$: Observable<ConstantSignal> = this.outputSubject.asObservable();

  // For relay type, store URLs to emit all on subscription
  private relayUrls: string[] = [];

  // Getter that returns appropriate observable based on type
  public get output$(): Observable<ConstantSignal> {
    if (this.constantType === 'relay') {
      // For relay type, emit all stored URLs on each subscription
      return defer(() => {
        const signals = this.relayUrls.map(url => ({
          type: 'relay' as ConstantType,
          value: url,
        }));
        return from(signals);
      });
    }
    return this._baseOutput$;
  }

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
          // Notify graph to re-render the node with new control
          window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));

          // For pubkey type, try to get NIP-07 pubkey first before emitting
          if (this.constantType === 'pubkey') {
            tryGetNip07Pubkey().then(pubkey => {
              if (this.constantType === 'pubkey') {
                if (pubkey) {
                  this.rawValue = pubkey;
                  this.updateValueControl();
                }
                this.emitValue();
              }
            });
          } else {
            this.emitValue();
          }
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
        // Toggle switch for flag
        this.addControl(
          'value',
          new ToggleControl(
            this.rawValue === '1',
            i18next.t('nodes.constant.value', 'Value'),
            (value) => {
              this.rawValue = value ? '1' : '0';
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

    // For relay type with multiple URLs, store URLs for emission on subscription
    if (this.constantType === 'relay' && Array.isArray(value)) {
      this.relayUrls = value;
      // Don't emit through subject - the getter handles relay type specially
      // Note: defer(() => from(signals)) naturally completes after emitting all values
    } else {
      this.relayUrls = [];
      // Recreate subject to allow complete() and re-emission on value change
      this.outputSubject = new ReplaySubject<ConstantSignal>(1);
      this._baseOutput$ = this.outputSubject.asObservable();
      this.outputSubject.next({
        type: this.constantType,
        value,
      });
      // Complete the subject to signal that all values have been emitted
      this.outputSubject.complete();
    }
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
