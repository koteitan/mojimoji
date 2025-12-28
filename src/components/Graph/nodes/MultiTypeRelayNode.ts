import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
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
import { FilterControl } from './controls';
import type { Filters } from './controls';
import type { NostrEvent, Profile, EventSignal } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64 } from '../../../nostr/types';
import { findPubkeysByName } from '../../../nostr/profileCache';
import { ProfileFetcher } from '../../../nostr/ProfileFetcher';
import { SharedSubscriptionManager } from '../../../nostr/SharedSubscriptionManager';

// Signal type for relay status output
export interface RelayStatusSignal {
  relay: string;
  status: RelayStatusType;
}

// Default filters: empty (single element for UI)
const getDefaultFilters = (): Filters => [
  [
    { field: 'kinds', value: '' },
  ],
];

// Get socket type for a filter field
function getSocketForField(field: string): ClassicPreset.Socket {
  switch (field) {
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
      return eventIdSocket; // Default for unknown tag fields
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

export class MultiTypeRelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'MultiTypeRelay';
  readonly nodeType = 'MultiTypeRelay';
  width = 300;
  height: number | undefined = undefined;

  private filters: Filters = getDefaultFilters();

  // Track current input sockets (key -> field type)
  private currentSockets: Map<string, string> = new Map();

  // Input values from sockets (key -> values)
  private socketValues: Map<string, unknown[]> = new Map();

  // Socket input subscriptions (key -> subscription)
  private socketSubscriptions: Map<string, { unsubscribe: () => void }> = new Map();

  // Relay input values
  private relayUrls: string[] = [];
  private relayInputSubscription: { unsubscribe: () => void } | null = null;

  // Trigger input
  private triggerSubscription: { unsubscribe: () => void } | null = null;
  private triggerState: boolean = false;

  // RxJS Observable for output events
  private eventSubject = new Subject<EventSignal>();
  private relayStatusSubject = new Subject<RelayStatusSignal>();
  private subscribedRelayUrls: string[] = [];  // Track which relays we're subscribed to

  // Profile updates - uses ProfileFetcher for batching
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();
  private profileFetchers: Map<string, ProfileFetcher> = new Map();  // Per-relay ProfileFetchers

  // Connection monitoring (per relay)
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

    // Trigger input socket (uses flagSocket for compatibility with Flag type)
    this.addInput('trigger', new ClassicPreset.Input(flagSocket, 'Trigger'));

    // Relay input socket
    this.addInput('relay', new ClassicPreset.Input(relaySocket, 'Relay'));

    // Output sockets
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));
    this.addOutput('relayStatus', new ClassicPreset.Output(relayStatusSocket, 'Relay Status'));

    // Filter control - sockets are generated based on filter elements
    // hideValues=true because values come from input sockets
    this.addControl(
      'filter',
      new FilterControl(
        this.filters,
        i18next.t('nodes.relay.filter', 'Filter'),
        (filters) => {
          this.filters = filters;
          this.updateSocketsFromFilters();
        },
        true // hideValues
      )
    );

    // Initialize sockets from default filters
    this.updateSocketsFromFilters();
  }

  // Update input sockets based on current filter elements
  private updateSocketsFromFilters(): void {
    const newSockets = new Map<string, string>();

    // Collect all filter elements that need sockets
    for (let fi = 0; fi < this.filters.length; fi++) {
      const filter = this.filters[fi];
      for (let ei = 0; ei < filter.length; ei++) {
        const element = filter[ei];
        const key = makeSocketKey(fi, ei);
        newSockets.set(key, element.field);
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
        // Field type changed or new socket - remove old and add new
        if (existingField !== undefined) {
          this.removeInput(key);
          this.socketValues.delete(key);
        }
        const socket = getSocketForField(field);
        const label = `${field}`;
        this.addInput(key, new ClassicPreset.Input(socket, label));
      }
    }

    this.currentSockets = newSockets;

    // Notify that sockets changed via custom event
    window.dispatchEvent(new CustomEvent('graph-sockets-change', { detail: { nodeId: this.id } }));
  }

  // Get socket key for a filter element
  getSocketKey(filterIndex: number, elementIndex: number): string {
    return makeSocketKey(filterIndex, elementIndex);
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  // Set relay input from connected node
  // Accepts both ConstantNode format { type: 'relay', value: string[] } and direct { relays: string[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRelayInput(input: Observable<any> | null): void {
    // Cleanup existing subscription
    if (this.relayInputSubscription) {
      this.relayInputSubscription.unsubscribe();
      this.relayInputSubscription = null;
    }

    this.relayUrls = [];

    if (!input) {
      return;
    }

    this.relayInputSubscription = input.subscribe({
      next: (signal) => {
        // Handle various relay signal formats:
        // - ConstantNode: { type: 'relay', value: string | string[] }
        // - ExtractionNode: { relay: string, signal: 'add' | 'remove' }
        // - Direct: { relays: string[] }
        let relayArray: string[] = [];

        if (typeof signal === 'string') {
          // Direct string URL
          relayArray = [signal];
        } else if (signal.relay && typeof signal.relay === 'string') {
          // ExtractionNode format: { relay: string }
          relayArray = [signal.relay];
        } else if (signal.value !== undefined) {
          // ConstantNode format: { value: string | string[] }
          relayArray = Array.isArray(signal.value) ? signal.value : [signal.value];
        } else if (signal.relays) {
          // Direct format: { relays: string[] }
          relayArray = Array.isArray(signal.relays) ? signal.relays : [signal.relays];
        }

        // Accumulate relay URLs from input
        for (const url of relayArray) {
          if (typeof url === 'string' && url.trim() && !this.relayUrls.includes(url)) {
            this.relayUrls.push(url);
            // Emit idle status for newly added relay if subscription not yet started
            if (!this.isSubscribed()) {
              this.relayStatusSubject.next({ relay: url, status: 'idle' });
            }
          }
        }

        // Try to start subscription if trigger is already true
        this.tryStartSubscription();
      },
    });
  }

  // Check if all required inputs are connected
  private areAllInputsConnected(): boolean {
    // Check trigger input is connected
    if (!this.triggerSubscription) return false;

    // Check relay input is connected
    if (!this.relayInputSubscription) return false;

    // Check all filter socket inputs are connected
    for (const socketKey of this.currentSockets.keys()) {
      if (!this.socketSubscriptions.has(socketKey)) return false;
    }

    return true;
  }

  // Check if all connected socket inputs have received values
  private areAllSocketValuesReceived(): boolean {
    for (const socketKey of this.currentSockets.keys()) {
      // Only check sockets that are connected
      if (this.socketSubscriptions.has(socketKey)) {
        const values = this.socketValues.get(socketKey);
        if (!values || values.length === 0) {
          return false;
        }
      }
    }
    return true;
  }

  // Try to start subscription if conditions are met
  private tryStartSubscription(): void {
    if (this.triggerState && this.relayUrls.length > 0 && this.areAllInputsConnected() && this.areAllSocketValuesReceived() && !this.isSubscribed()) {
      this.startSubscription();
    }
  }

  // Build filters combining attribute values and input socket values
  private buildFilters(): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];

    for (let fi = 0; fi < this.filters.length; fi++) {
      const filter = this.filters[fi];
      const nostrFilter: Record<string, unknown> = {};

      for (let ei = 0; ei < filter.length; ei++) {
        const element = filter[ei];
        const { field, value } = element;
        const socketKey = makeSocketKey(fi, ei);
        const socketValue = this.socketValues.get(socketKey);
        const isSocketConnected = this.socketSubscriptions.has(socketKey);

        // Use socket value if connected, otherwise use attribute value
        if (socketValue && socketValue.length > 0) {
          this.applySocketValueToFilter(nostrFilter, field, socketValue);
        } else if (isSocketConnected && (field === 'kinds' || field === 'authors' || field === 'ids' || field.startsWith('#'))) {
          // Socket is connected but no value yet - include empty array to prevent matching all
          nostrFilter[field] = [];
        } else if (value.trim()) {
          this.applyAttributeValueToFilter(nostrFilter, field, value);
        }
      }

      if (Object.keys(nostrFilter).length > 0) {
        result.push(nostrFilter);
      }
    }

    return result.length > 0 ? result : [{}];
  }

  // Apply socket value to filter
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
      filter[field] = values.filter((v): v is string => typeof v === 'string');
    }
  }

  // Apply attribute value to filter
  private applyAttributeValueToFilter(filter: Record<string, unknown>, field: string, value: string): void {
    if (field === 'kinds') {
      filter[field] = value.split(',').map((v) => parseInt(v.trim(), 10)).filter((n) => !isNaN(n));
    } else if (field === 'limit') {
      const num = parseInt(value.trim(), 10);
      if (!isNaN(num)) {
        filter[field] = num;
      }
    } else if (field === 'since' || field === 'until') {
      const num = parseInt(value.trim(), 10);
      if (!isNaN(num)) {
        filter[field] = num;
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

    // For pubkey fields, try name lookup
    if (_field === 'authors' || _field === '#p') {
      const matches = findPubkeysByName(trimmed);
      if (matches.length > 0) {
        return matches;
      }
    }

    return [trimmed];
  }

  // Set trigger input (accepts flag signal: { type: 'flag', value: boolean } or { flag: boolean })
  setTriggerInput(input: Observable<{ value?: boolean; flag?: boolean }> | null): void {
    // Cleanup existing trigger subscription
    if (this.triggerSubscription) {
      this.triggerSubscription.unsubscribe();
      this.triggerSubscription = null;
    }

    if (!input) {
      this.triggerState = false;
      return;
    }

    // Subscribe and store reference
    this.triggerSubscription = input.subscribe({
      next: (signal) => {
        // Handle both ConstantNode format { value: boolean } and FlagSignal format { flag: boolean }
        const flagValue = signal.value ?? signal.flag ?? false;
        this.triggerState = flagValue;

        // Simply try to start when true, stop when false
        // tryStartSubscription() already checks !isSubscribed(), so it's safe to call multiple times
        if (flagValue) {
          this.tryStartSubscription();
        } else {
          this.stopSubscription();
        }
      },
    });
  }

  // Set input for a socket by key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSocketInput(socketKey: string, input: Observable<any> | null): void {
    // Unsubscribe existing subscription for this socket
    const existingSubscription = this.socketSubscriptions.get(socketKey);
    if (existingSubscription) {
      existingSubscription.unsubscribe();
      this.socketSubscriptions.delete(socketKey);
    }

    if (!input) {
      this.socketValues.delete(socketKey);
      return;
    }

    // Get the field type for this socket
    const parsed = parseSocketKey(socketKey);
    if (!parsed) return;

    const { filterIndex, elementIndex } = parsed;
    const filter = this.filters[filterIndex];
    if (!filter) return;
    const element = filter[elementIndex];
    if (!element) return;

    const field = element.field;
    this.socketValues.set(socketKey, []);

    const subscription = input.subscribe({
      next: (signal) => {
        const values = this.socketValues.get(socketKey) || [];

        // Extract value based on signal format
        // ConstantNode emits { type: string, value: unknown }
        // Nip07Node emits { pubkey: string }
        // IfNode emits { flag: boolean }
        // Other nodes may emit the value directly
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

        // For array fields, accumulate values; for scalar fields, replace
        if (field === 'limit' || field === 'since' || field === 'until') {
          this.socketValues.set(socketKey, [value]);
        } else {
          if (!values.includes(value)) {
            values.push(value);
            this.socketValues.set(socketKey, values);
          }
        }

        // Try to start subscription when socket value is received
        this.tryStartSubscription();
      },
    });

    // Store the subscription for later cleanup
    this.socketSubscriptions.set(socketKey, subscription);
  }

  // Check if this node has input sockets
  hasInputSockets(): boolean {
    return this.currentSockets.size > 0;
  }

  // Get all socket keys
  getSocketKeys(): string[] {
    return Array.from(this.currentSockets.keys());
  }

  // Start the nostr subscription
  startSubscription(): void {
    this.stopSubscription();

    const relayUrls = this.getRelayUrls();
    if (relayUrls.length === 0) return;

    this.eventCount = 0;
    this.eoseReceived = false;

    const filters = this.buildFilters();
    if (filters.length === 0) return;

    // Subscribe to each relay via SharedSubscriptionManager
    this.subscribedRelayUrls = [...relayUrls];
    for (const relayUrl of this.subscribedRelayUrls) {
      // Create ProfileFetcher for this relay using shared RxNostr
      const rxNostr = SharedSubscriptionManager.getRxNostr(relayUrl);
      const profileFetcher = new ProfileFetcher(rxNostr, `${this.id}-${relayUrl}`);
      profileFetcher.start((pubkey, profile) => {
        this.profileSubject.next({ pubkey, profile });
      });
      this.profileFetchers.set(relayUrl, profileFetcher);

      // Monitor connection state changes and emit relay status
      const connectionStateSub = rxNostr.createConnectionStateObservable().subscribe({
        next: (packet) => {
          // Map rx-nostr connection state to our RelayStatusType
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

      // Subscribe via SharedSubscriptionManager
      SharedSubscriptionManager.subscribe(
        relayUrl,
        this.id,
        filters,
        (event: NostrEvent) => {
          this.eventCount++;
          this.eventSubject.next({ event, signal: 'add' });
          const pf = this.profileFetchers.get(relayUrl);
          pf?.queueRequest(event.pubkey);
        },
        () => {
          // EOSE callback
          this.eoseReceived = true;
          this.relayStatusSubject.next({ relay: relayUrl, status: 'EOSE' });
        }
      );
    }
  }

  stopSubscription(): void {
    // Unsubscribe from all relays via SharedSubscriptionManager
    for (const relayUrl of this.subscribedRelayUrls) {
      SharedSubscriptionManager.unsubscribe(relayUrl, this.id);
    }
    this.subscribedRelayUrls = [];

    // Stop all ProfileFetchers
    for (const profileFetcher of this.profileFetchers.values()) {
      profileFetcher.stop();
    }
    this.profileFetchers.clear();

    // Stop all connection state subscriptions
    for (const sub of this.connectionStateSubscriptions.values()) {
      sub.unsubscribe();
    }
    this.connectionStateSubscriptions.clear();
  }

  // Stop all subscriptions including trigger, relay input, and socket inputs
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
    // Unsubscribe all socket input subscriptions
    for (const subscription of this.socketSubscriptions.values()) {
      subscription.unsubscribe();
    }
    this.socketSubscriptions.clear();
  }

  isSubscribed(): boolean {
    return this.subscribedRelayUrls.length > 0;
  }

  serialize() {
    return {
      filters: this.filters,
    };
  }

  deserialize(data: { filters?: Filters }) {
    if (data.filters) {
      this.filters = data.filters;
    }

    const filterControl = this.controls['filter'] as FilterControl;
    if (filterControl) {
      filterControl.filters = this.filters;
    }

    // Update sockets based on restored filters
    this.updateSocketsFromFilters();
  }
}
