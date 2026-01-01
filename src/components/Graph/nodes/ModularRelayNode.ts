import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxBackwardReq } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import i18next from 'i18next';
import {
  eventSocket,
  integerSocket,
  datetimeSocket,
  eventIdSocket,
  pubkeySocket,
  flagSocket,
  relaySocket,
  relayStatusSocket,
} from './types';
import type { RelayStatusType } from './types';
import { FilterControl, ToggleControl, TextInputControl, isSocketField, getBaseField } from './controls';
import type { Filters } from './controls';
import type { NostrEvent, Profile, EventSignal } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';
import { findPubkeysByName } from '../../../nostr/profileCache';
import { SharedSubscriptionManager } from '../../../nostr/SharedSubscriptionManager';

// Strategy type for subscription mode
export type SubscriptionStrategy = 'forward' | 'backward';

// Signal type for relay status output
export interface RelayStatusSignal {
  relay: string;
  status: RelayStatusType;
}

// Default filters for UI (same as SimpleRelayNode)
const getDefaultFilters = (): Filters => [
  [
    { field: 'kinds', value: '1' },
    { field: 'limit', value: '200' },
  ],
];

// Get socket type for a filter field
function getSocketForField(field: string): ClassicPreset.Socket {
  const baseField = getBaseField(field);
  switch (baseField) {
    case 'kinds':
    case 'limit':
      return integerSocket;
    case 'since':
    case 'until':
      return datetimeSocket;
    case 'ids':
    case '#e':
      return eventIdSocket;
    case 'authors':
    case '#p':
      return pubkeySocket;
    default:
      return eventIdSocket;
  }
}

// Generate socket key from filter and element index
function makeSocketKey(filterIndex: number, elementIndex: number): string {
  return `f${filterIndex}_e${elementIndex}`;
}

// Parse socket key to get indices
function parseSocketKey(key: string): { filterIndex: number; elementIndex: number } | null {
  const match = key.match(/^f(\d+)_e(\d+)$/);
  if (!match) return null;
  return { filterIndex: parseInt(match[1], 10), elementIndex: parseInt(match[2], 10) };
}

export class ModularRelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'ModularRelay';
  readonly nodeType = 'ModularRelay';
  width = 300;
  height: number | undefined = undefined;

  // UI filter values
  private filters: Filters = getDefaultFilters();

  // Track current dynamic input sockets (key -> field type)
  private currentSockets: Map<string, string> = new Map();

  // Socket input values (key -> values)
  private socketValues: Map<string, unknown[]> = new Map();

  // Socket input completion status (key -> completed)
  private socketCompleted: Map<string, boolean> = new Map();

  // Socket input subscriptions (key -> subscription)
  private socketSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();

  // Relay input values
  private relayUrls: string[] = [];
  private relayInputSubscription: { unsubscribe: () => void } | null = null;
  private relayInputCompleted: boolean = false;

  // External trigger setting
  private externalTrigger: boolean = false;

  // Subscription strategy (forward = realtime, backward = one-shot)
  private strategy: SubscriptionStrategy = 'forward';

  // EOSE timeout for backward strategy (rx-nostr default: 30000ms)
  private eoseTimeout: number = 30000;

  // Backward subscription resources
  private backwardRxNostr: ReturnType<typeof createRxNostr> | null = null;
  private backwardSubscription: { unsubscribe: () => void } | null = null;

  // Trigger input
  private triggerSubscription: { unsubscribe: () => void } | null = null;
  private triggerState: boolean = true; // default true when no external trigger

  // RxJS Observable for output events
  private eventSubject = new Subject<EventSignal>();
  private relayStatusSubject = new Subject<RelayStatusSignal>();
  private subscribedRelayUrls: string[] = [];

  // Profile updates (kept for backward compatibility, but no longer actively used)
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();

  // Connection monitoring
  private connectionStateSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();

  // Debug counters
  private eventCount = 0;
  public eoseReceived = false;

  // Shared observables
  public output$: Observable<EventSignal> = this.eventSubject.asObservable().pipe(share());
  public relayStatus$: Observable<RelayStatusSignal> = this.relayStatusSubject.asObservable().pipe(share());
  public profile$: Observable<{ pubkey: string; profile: Profile }> = this.profileSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.modularRelay.title', 'Modular Relay'));

    // Relay input socket
    this.addInput('relay', new ClassicPreset.Input(relaySocket, 'Relay'));

    // Output sockets
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));
    this.addOutput('relayStatus', new ClassicPreset.Output(relayStatusSocket, 'Relay Status'));

    // External trigger toggle (when ON, shows trigger socket)
    this.addControl(
      'externalTrigger',
      new ToggleControl(
        this.externalTrigger,
        i18next.t('nodes.modularRelay.subTrigger', 'sub trigger'),
        (value) => {
          this.externalTrigger = value;
          this.updateTriggerSocket();
        },
        'auto',
        'manual'
      )
    );

    // Strategy toggle (forward = realtime stream, backward = one-shot query)
    this.addControl(
      'strategy',
      new ToggleControl(
        this.strategy === 'forward',
        i18next.t('nodes.modularRelay.strategy', 'Strategy'),
        (value) => {
          this.strategy = value ? 'forward' : 'backward';
          // Enable/disable eoseTimeout control based on strategy
          const eoseControl = this.controls['eoseTimeout'] as TextInputControl;
          if (eoseControl) {
            eoseControl.disabled = this.strategy === 'forward';
          }
        },
        'backward',
        'forward'
      )
    );

    // EOSE timeout control (only applicable for backward strategy)
    this.addControl(
      'eoseTimeout',
      new TextInputControl(
        String(this.eoseTimeout),
        i18next.t('nodes.modularRelay.eoseTimeout', 'EOSE timeout'),
        (value) => {
          this.eoseTimeout = parseInt(value) || 30000;
        },
        true,
        '30000',
        this.strategy === 'forward', // disabled when forward
        true, // horizontal layout
        'ms'  // suffix
      )
    );

    // Filter control with modular fields (includes socket options)
    this.addControl(
      'filter',
      new FilterControl(
        this.filters,
        i18next.t('nodes.relay.filter', 'Filter'),
        (filters) => {
          this.filters = filters;
          this.updateSocketsFromFilters();
        },
        false, // hideValues
        true   // useModularFields - show socket options in dropdown
      )
    );

    // Initialize sockets from default filters
    this.updateSocketsFromFilters();
  }

  // Update input sockets based on socket fields in filters
  private updateSocketsFromFilters(): void {
    const newSockets = new Map<string, string>();

    // Collect all socket fields from filter elements
    for (let fi = 0; fi < this.filters.length; fi++) {
      const filter = this.filters[fi];
      for (let ei = 0; ei < filter.length; ei++) {
        const element = filter[ei];
        if (isSocketField(element.field)) {
          const key = makeSocketKey(fi, ei);
          newSockets.set(key, element.field);
        }
      }
    }

    // Remove sockets that no longer exist
    for (const [key, _field] of this.currentSockets) {
      if (!newSockets.has(key)) {
        this.removeInput(key);
        this.socketValues.delete(key);
      }
    }

    // Add or update sockets
    for (const [key, field] of newSockets) {
      const existingField = this.currentSockets.get(key);
      if (existingField !== field) {
        if (existingField !== undefined) {
          this.removeInput(key);
          this.socketValues.delete(key);
        }
        const socket = getSocketForField(field);
        const label = getBaseField(field); // e.g., "kinds"
        this.addInput(key, new ClassicPreset.Input(socket, label));
      }
    }

    this.currentSockets = newSockets;

    // Notify that sockets changed
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  // Update trigger socket based on externalTrigger setting
  private updateTriggerSocket(): void {
    if (this.externalTrigger) {
      // Add trigger socket if not exists
      if (!this.inputs['trigger']) {
        this.addInput('trigger', new ClassicPreset.Input(flagSocket, 'Trigger'));
        this.triggerState = false; // need external trigger input
      }
    } else {
      // Remove trigger socket if exists
      if (this.inputs['trigger']) {
        if (this.triggerSubscription) {
          this.triggerSubscription.unsubscribe();
          this.triggerSubscription = null;
        }
        this.removeInput('trigger');
        this.triggerState = true; // auto-trigger when no external
        this.tryStartSubscription();
      }
    }

    // Notify that sockets changed
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  getSocketKey(filterIndex: number, elementIndex: number): string {
    return makeSocketKey(filterIndex, elementIndex);
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRelayInput(input: Observable<any> | null): void {
    if (this.relayInputSubscription) {
      this.relayInputSubscription.unsubscribe();
      this.relayInputSubscription = null;
    }

    this.relayUrls = [];
    this.relayInputCompleted = false;

    if (!input) return;

    this.relayInputSubscription = input.subscribe({
      next: (signal) => {
        let relayArray: string[] = [];

        if (typeof signal === 'string') {
          relayArray = [signal];
        } else if (signal.relay && typeof signal.relay === 'string') {
          relayArray = [signal.relay];
        } else if (signal.value !== undefined) {
          relayArray = Array.isArray(signal.value) ? signal.value : [signal.value];
        } else if (signal.relays) {
          relayArray = Array.isArray(signal.relays) ? signal.relays : [signal.relays];
        }

        for (const url of relayArray) {
          if (typeof url === 'string' && url.trim() && !this.relayUrls.includes(url)) {
            this.relayUrls.push(url);
            if (!this.isSubscribed()) {
              this.relayStatusSubject.next({ relay: url, status: 'idle' });
            }
          }
        }

        this.tryStartSubscription();
      },
      complete: () => {
        this.relayInputCompleted = true;
        this.tryStartSubscription();
      },
    });
  }

  private areRequiredInputsConnected(): boolean {
    // Only check trigger if external trigger is enabled
    if (this.externalTrigger && !this.triggerSubscription) return false;
    if (!this.relayInputSubscription) return false;

    // Check all socket fields have connected sockets
    for (const socketKey of this.currentSockets.keys()) {
      if (!this.socketSubscriptions.has(socketKey)) return false;
    }

    return true;
  }

  private areAllSocketsCompleted(): boolean {
    // Check if relay input has completed
    if (this.relayInputSubscription && !this.relayInputCompleted) {
      return false;
    }
    // Check if all socket inputs have completed
    for (const socketKey of this.currentSockets.keys()) {
      if (this.socketSubscriptions.has(socketKey)) {
        if (!this.socketCompleted.get(socketKey)) {
          return false;
        }
      }
    }
    return true;
  }

  private tryStartSubscription(): void {
    // Start condition depends on external trigger mode:
    // - With external trigger: start when trigger fires (can override waiting for sockets)
    // - Without external trigger: wait for all socket inputs to complete
    const allCompleted = this.areAllSocketsCompleted();
    const hasRelays = this.relayUrls.length > 0;
    const inputsConnected = this.areRequiredInputsConnected();
    const notSubscribed = !this.isSubscribed();

    // Determine if we should start:
    // - If externalTrigger is enabled: use triggerState (start when trigger is true)
    // - If externalTrigger is disabled: use allCompleted (start when all sockets complete)
    const shouldStart = this.externalTrigger ? this.triggerState : allCompleted;
    const canStart = shouldStart && hasRelays && inputsConnected && notSubscribed;

    if (canStart) {
      this.startSubscription();
    }
  }

  // Build filters combining UI values and socket values
  private buildFilters(): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (let fi = 0; fi < this.filters.length; fi++) {
      const filter = this.filters[fi];
      const nostrFilter: Record<string, unknown> = {};

      for (let ei = 0; ei < filter.length; ei++) {
        const element = filter[ei];
        const { field, value } = element;

        if (isSocketField(field)) {
          // Socket field - get value from socket
          const socketKey = makeSocketKey(fi, ei);
          const socketValue = this.socketValues.get(socketKey);
          const baseField = getBaseField(field);

          if (socketValue && socketValue.length > 0) {
            this.applySocketValueToFilter(nostrFilter, baseField, socketValue);
          } else if (this.socketSubscriptions.has(socketKey)) {
            // Socket connected but no value yet
            if (baseField === 'kinds' || baseField === 'authors' || baseField === 'ids' || baseField.startsWith('#')) {
              nostrFilter[baseField] = [];
            }
          }
        } else {
          // UI field - get value from text input
          if (value.trim()) {
            this.applyAttributeValueToFilter(nostrFilter, field, value);
          }
        }
      }

      if (Object.keys(nostrFilter).length > 0) {
        result.push(nostrFilter);
      }
    }

    return result.length > 0 ? result : [{}];
  }

  private applySocketValueToFilter(filter: Record<string, unknown>, field: string, values: unknown[]): void {
    if (field === 'kinds') {
      filter[field] = values.filter((v): v is number => typeof v === 'number');
    } else if (field === 'limit') {
      const num = values[0];
      if (typeof num === 'number') {
        filter[field] = num;
      }
    } else if (field === 'since' || field === 'until') {
      const num = values[0];
      if (typeof num === 'number') {
        filter[field] = num;
      }
    } else if (field === 'ids' || field === 'authors' || field.startsWith('#')) {
      // Convert bech32 (npub, nevent, note) to hex
      const hexValues = values
        .filter((v): v is string => typeof v === 'string')
        .map((v) => {
          const decoded = decodeBech32ToHex(v);
          if (decoded) {
            return decoded.hex;
          }
          if (isHex64(v)) {
            return v.toLowerCase();
          }
          return v;
        });
      filter[field] = hexValues;
    }
  }

  private applyAttributeValueToFilter(filter: Record<string, unknown>, field: string, value: string): void {
    if (field === 'kinds') {
      filter[field] = value.split(',').map((v) => parseInt(v.trim(), 10)).filter((n) => !isNaN(n));
    } else if (field === 'limit') {
      const num = parseInt(value.trim(), 10);
      if (!isNaN(num)) {
        filter[field] = num;
      }
    } else if (field === 'since' || field === 'until') {
      const ts = parseDateToTimestamp(value.trim());
      if (ts !== null) {
        filter[field] = ts;
      }
    } else if (field === 'ids' || field === 'authors' || field.startsWith('#')) {
      const resolved = value.split(',').flatMap((v) => this.resolveIdentifier(v, field));
      if (resolved.length > 0) {
        filter[field] = resolved;
      }
    }
  }

  private resolveIdentifier(value: string, _field: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const decoded = decodeBech32ToHex(trimmed);
    if (decoded) {
      return [decoded.hex];
    }

    if (isHex64(trimmed)) {
      return [trimmed.toLowerCase()];
    }

    if (_field === 'authors' || _field === '#p') {
      const matches = findPubkeysByName(trimmed);
      if (matches.length > 0) {
        return matches;
      }
    }

    return [trimmed];
  }

  setTriggerInput(input: Observable<{ value?: boolean; flag?: boolean }> | null): void {
    if (this.triggerSubscription) {
      this.triggerSubscription.unsubscribe();
      this.triggerSubscription = null;
    }

    if (!input) {
      // If external trigger is disabled, auto-trigger (triggerState = true)
      // If external trigger is enabled but no input, wait for trigger (triggerState = false)
      this.triggerState = !this.externalTrigger;
      if (this.triggerState) {
        this.tryStartSubscription();
      }
      return;
    }

    this.triggerSubscription = input.subscribe({
      next: (signal) => {
        const flagValue = signal.value ?? signal.flag ?? false;
        this.triggerState = flagValue;

        if (flagValue) {
          this.tryStartSubscription();
        } else {
          this.stopSubscription();
        }
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSocketInput(socketKey: string, input: Observable<any> | null): void {
    const existingSubscription = this.socketSubscriptions.get(socketKey);
    if (existingSubscription) {
      existingSubscription.unsubscribe();
      this.socketSubscriptions.delete(socketKey);
    }

    if (!input) {
      this.socketValues.delete(socketKey);
      this.socketCompleted.delete(socketKey);
      return;
    }

    const parsed = parseSocketKey(socketKey);
    if (!parsed) return;

    const { filterIndex, elementIndex } = parsed;
    const filter = this.filters[filterIndex];
    if (!filter) return;
    const element = filter[elementIndex];
    if (!element) return;

    const baseField = getBaseField(element.field);
    this.socketValues.set(socketKey, []);
    this.socketCompleted.set(socketKey, false);

    const subscription = input.subscribe({
      next: (signal) => {
        const values = this.socketValues.get(socketKey) || [];

        let value: unknown;
        if (typeof signal === 'object' && signal !== null) {
          if ('value' in signal) {
            value = (signal as { value: unknown }).value;
          } else if ('pubkey' in signal) {
            value = (signal as { pubkey: string }).pubkey;
          } else if ('flag' in signal) {
            value = (signal as { flag: boolean }).flag;
          } else if ('eventId' in signal) {
            value = (signal as { eventId: string }).eventId;
          } else if ('datetime' in signal) {
            value = (signal as { datetime: number }).datetime;
          } else {
            value = signal;
          }
        } else {
          value = signal;
        }

        if (baseField === 'limit' || baseField === 'since' || baseField === 'until') {
          this.socketValues.set(socketKey, [value]);
        } else {
          if (!values.includes(value)) {
            values.push(value);
            this.socketValues.set(socketKey, values);
          }
        }

        this.tryStartSubscription();
      },
      complete: () => {
        this.socketCompleted.set(socketKey, true);
        this.tryStartSubscription();
      },
    });

    this.socketSubscriptions.set(socketKey, subscription);
  }

  hasInputSockets(): boolean {
    return this.currentSockets.size > 0;
  }

  getSocketKeys(): string[] {
    return Array.from(this.currentSockets.keys());
  }

  startSubscription(): void {
    this.stopSubscription();

    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) return;

    this.eventCount = 0;
    this.eoseReceived = false;

    const filters = this.buildFilters();
    if (filters.length === 0) return;

    this.subscribedRelayUrls = [...relayUrls];

    if (this.strategy === 'backward') {
      // Backward strategy: one-shot query, complete after EOSE
      this.startBackwardSubscription(relayUrls, filters);
    } else {
      // Forward strategy: realtime stream (default)
      this.startForwardSubscription(relayUrls, filters);
    }
  }

  private startForwardSubscription(relayUrls: string[], filters: Record<string, unknown>[]): void {
    for (const relayUrl of relayUrls) {
      const rxNostr = SharedSubscriptionManager.getRxNostr(relayUrl);

      const connectionStateSub = rxNostr.createConnectionStateObservable().subscribe({
        next: (packet) => {
          let status: RelayStatusType;
          switch (packet.state) {
            case 'initialized':
              status = 'idle';
              break;
            case 'connecting':
            case 'waiting-for-retrying':
              status = 'connecting';
              break;
            case 'connected':
              status = 'sub-stored';
              break;
            case 'dormant':
            case 'terminated':
              status = 'closed';
              break;
            case 'error':
            case 'rejected':
              status = 'error';
              break;
            default:
              status = 'idle';
          }
          this.relayStatusSubject.next({ relay: packet.from, status });
        },
      });
      this.connectionStateSubscriptions.set(relayUrl, connectionStateSub);

      SharedSubscriptionManager.subscribe(
        relayUrl,
        this.id,
        filters,
        (event: NostrEvent) => {
          this.eventCount++;
          this.eventSubject.next({ event, signal: 'add' });
        },
        () => {
          this.eoseReceived = true;
          this.relayStatusSubject.next({ relay: relayUrl, status: 'EOSE' });
        }
      );
    }
  }

  private startBackwardSubscription(relayUrls: string[], filters: Record<string, unknown>[]): void {
    // Create dedicated rxNostr for backward subscription with eoseTimeout
    this.backwardRxNostr = createRxNostr({ verifier, eoseTimeout: this.eoseTimeout });
    this.backwardRxNostr.setDefaultRelays(relayUrls);

    const rxReq = createRxBackwardReq();

    // Track EOSE per relay to know when all are done
    const pendingRelays = new Set(relayUrls);

    this.backwardSubscription = this.backwardRxNostr.use(rxReq).subscribe({
      next: (packet) => {
        this.eventCount++;
        this.eventSubject.next({ event: packet.event as NostrEvent, signal: 'add' });
      },
      complete: () => {
        // All relays have sent EOSE and closed
        this.eoseReceived = true;
        for (const relayUrl of relayUrls) {
          this.relayStatusSubject.next({ relay: relayUrl, status: 'EOSE' });
        }
        // Complete the event subject for backward strategy
        this.eventSubject.complete();
        // Recreate subject for potential future subscriptions
        this.eventSubject = new Subject<EventSignal>();
        this.output$ = this.eventSubject.asObservable().pipe(share());
      },
    });

    // Monitor connection state
    const connectionStateSub = this.backwardRxNostr.createConnectionStateObservable().subscribe({
      next: (packet) => {
        let status: RelayStatusType;
        switch (packet.state) {
          case 'initialized':
            status = 'idle';
            break;
          case 'connecting':
          case 'waiting-for-retrying':
            status = 'connecting';
            break;
          case 'connected':
            status = 'sub-stored';
            break;
          case 'dormant':
          case 'terminated':
            status = 'closed';
            pendingRelays.delete(packet.from);
            break;
          case 'error':
          case 'rejected':
            status = 'error';
            pendingRelays.delete(packet.from);
            break;
          default:
            status = 'idle';
        }
        this.relayStatusSubject.next({ relay: packet.from, status });
      },
    });
    this.connectionStateSubscriptions.set('backward-connection', connectionStateSub);

    // Emit each filter separately (rx-nostr expects single filter per emit)
    for (const filter of filters) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rxReq.emit(filter as any, { relays: relayUrls });
    }
    rxReq.over();
  }

  stopSubscription(): void {
    // Stop forward subscriptions
    for (const relayUrl of this.subscribedRelayUrls) {
      SharedSubscriptionManager.unsubscribe(relayUrl, this.id);
    }
    this.subscribedRelayUrls = [];

    // Stop backward subscription
    if (this.backwardSubscription) {
      this.backwardSubscription.unsubscribe();
      this.backwardSubscription = null;
    }
    if (this.backwardRxNostr) {
      this.backwardRxNostr.dispose();
      this.backwardRxNostr = null;
    }

    for (const sub of this.connectionStateSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.connectionStateSubscriptions.clear();
  }

  stopAllSubscriptions(): void {
    this.stopSubscription();
    if (this.triggerSubscription) {
      this.triggerSubscription.unsubscribe();
      this.triggerSubscription = null;
    }
    if (this.relayInputSubscription) {
      this.relayInputSubscription.unsubscribe();
      this.relayInputSubscription = null;
    }
    for (const subscription of this.socketSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.socketSubscriptions.clear();
  }

  isSubscribed(): boolean {
    return this.subscribedRelayUrls.length > 0;
  }

  // Get subscription status for debugging
  getSubscriptionStatus(): 'wait for trigger' | 'wait for complete' | 'subscribing' | 'EOSE' | 'closed' {
    if (this.isSubscribed()) {
      if (this.eoseReceived) {
        return 'EOSE';
      }
      return 'subscribing';
    }

    // Not subscribed yet
    if (this.externalTrigger && !this.triggerState) {
      return 'wait for trigger';
    }

    if (!this.areAllSocketsCompleted()) {
      return 'wait for complete';
    }

    return 'closed';
  }

  getStrategy(): SubscriptionStrategy {
    return this.strategy;
  }

  serialize() {
    return {
      filters: this.filters,
      externalTrigger: this.externalTrigger,
      strategy: this.strategy,
      eoseTimeout: this.eoseTimeout,
    };
  }

  deserialize(data: { filters?: Filters; externalTrigger?: boolean; strategy?: SubscriptionStrategy; eoseTimeout?: number }) {
    if (data.filters) {
      this.filters = data.filters;
    }

    if (data.externalTrigger !== undefined) {
      this.externalTrigger = data.externalTrigger;
      const toggleControl = this.controls['externalTrigger'] as ToggleControl;
      if (toggleControl) {
        toggleControl.value = this.externalTrigger;
      }
      this.updateTriggerSocket();
    }

    if (data.strategy !== undefined) {
      this.strategy = data.strategy;
    } else {
      // Migration: old graphs without strategy attribute always used forward
      this.strategy = 'forward';
    }
    const strategyControl = this.controls['strategy'] as ToggleControl;
    if (strategyControl) {
      strategyControl.value = this.strategy === 'forward';
    }

    // EOSE timeout migration
    if (data.eoseTimeout !== undefined) {
      this.eoseTimeout = data.eoseTimeout;
    } else {
      // Migration: old graphs without eoseTimeout use default (30000ms)
      this.eoseTimeout = 30000;
    }
    const eoseControl = this.controls['eoseTimeout'] as TextInputControl;
    if (eoseControl) {
      eoseControl.value = String(this.eoseTimeout);
      eoseControl.disabled = this.strategy === 'forward';
    }

    const filterControl = this.controls['filter'] as FilterControl;
    if (filterControl) {
      filterControl.filters = this.filters;
    }

    this.updateSocketsFromFilters();
  }
}
