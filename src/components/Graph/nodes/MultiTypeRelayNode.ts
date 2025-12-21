import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import i18next from 'i18next';
import {
  eventSocket,
  integerSocket,
  datetimeSocket,
  eventIdSocket,
  pubkeySocket,
  triggerSocket,
  relaySocket,
} from './types';
import { FilterControl } from './controls';
import type { Filters } from './controls';
import type { NostrEvent, Profile, EventSignal } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64 } from '../../../nostr/types';
import { getCachedProfile, findPubkeysByName } from './RelayNode';

// Type for the result of createRxForwardReq with emit method
type ForwardReq = ReturnType<typeof createRxForwardReq>;

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

  // Relay input values
  private relayUrls: string[] = [];
  private relayInputSubscription: { unsubscribe: () => void } | null = null;

  // Trigger input
  private triggerSubscription: { unsubscribe: () => void } | null = null;

  // RxJS Observable for output events
  private eventSubject = new Subject<EventSignal>();
  private rxNostr: RxNostr | null = null;
  private rxReq: ForwardReq | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Profile updates
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();
  private profileRxReq: ForwardReq | null = null;
  private profileSubscription: { unsubscribe: () => void } | null = null;
  private pendingProfiles = new Set<string>();
  private profileBatchQueue: string[] = [];
  private profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

  // Connection monitoring
  private messageSubscription: { unsubscribe: () => void } | null = null;
  private connectionStateSubscription: { unsubscribe: () => void } | null = null;

  // Debug counters
  private eventCount = 0;
  public eoseReceived = false;

  // Shared observables
  public output$: Observable<EventSignal> = this.eventSubject.asObservable().pipe(share());
  public profile$: Observable<{ pubkey: string; profile: Profile }> = this.profileSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.multiTypeRelay.title', 'Multi Relay'));

    // Trigger input socket
    this.addInput('trigger', new ClassicPreset.Input(triggerSocket, 'Trigger'));

    // Relay input socket
    this.addInput('relay', new ClassicPreset.Input(relaySocket, 'Relay'));

    // Output socket
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));

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
  setRelayInput(input: Observable<{ relays: string[] }> | null): void {
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
        // Accumulate relay URLs from input
        for (const url of signal.relays) {
          if (!this.relayUrls.includes(url)) {
            this.relayUrls.push(url);
          }
        }
      },
    });
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

        // Use socket value if connected, otherwise use attribute value
        if (socketValue && socketValue.length > 0) {
          this.applySocketValueToFilter(nostrFilter, field, socketValue);
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

  // Set trigger input
  setTriggerInput(input: Observable<{ value: number }> | null): void {
    // Cleanup existing trigger subscription
    if (this.triggerSubscription) {
      this.triggerSubscription.unsubscribe();
      this.triggerSubscription = null;
    }

    if (!input) {
      return;
    }

    this.triggerSubscription = input.subscribe({
      next: (signal) => {
        if (signal.value === 1) {
          // Trigger value is 1: start subscription
          this.startSubscription();
        } else if (signal.value === 0) {
          // Trigger value is 0: stop subscription
          this.stopSubscription();
        }
      },
    });
  }

  // Set input for a socket by key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSocketInput(socketKey: string, input: Observable<any> | null): void {
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

    input.subscribe({
      next: (signal) => {
        const values = this.socketValues.get(socketKey) || [];

        // Extract value based on field type
        let value: unknown;
        if (field === 'kinds' || field === 'limit') {
          value = signal.value ?? signal;
        } else if (field === 'since' || field === 'until') {
          value = signal.datetime ?? signal;
        } else if (field === 'ids' || field === '#e') {
          value = signal.eventId ?? signal;
        } else if (field === 'authors' || field === '#p') {
          value = signal.pubkey ?? signal;
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
      },
    });
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

    this.rxNostr = createRxNostr({ verifier });
    this.rxNostr.setDefaultRelays(relayUrls);

    this.rxReq = createRxForwardReq(`multirelay-${this.id}`);
    this.profileRxReq = createRxForwardReq(`profile-multi-${this.id}`);

    // Monitor messages
    this.messageSubscription = this.rxNostr.createAllMessageObservable().subscribe({
      next: (packet) => {
        if (packet.type === 'EOSE') {
          this.eoseReceived = true;
        }
      },
    });

    // Profile batch handling
    const flushProfileBatch = () => {
      if (this.profileBatchQueue.length === 0) return;
      const authors = [...this.profileBatchQueue];
      this.profileBatchQueue = [];
      this.profileRxReq?.emit({ kinds: [0], authors, limit: authors.length });
    };

    const queueProfileRequest = (pubkey: string) => {
      if (getCachedProfile(pubkey) || this.pendingProfiles.has(pubkey)) return;
      this.pendingProfiles.add(pubkey);
      this.profileBatchQueue.push(pubkey);

      if (this.profileBatchQueue.length >= 50) {
        if (this.profileBatchTimer) {
          clearTimeout(this.profileBatchTimer);
          this.profileBatchTimer = null;
        }
        flushProfileBatch();
      } else if (!this.profileBatchTimer) {
        this.profileBatchTimer = setTimeout(() => {
          this.profileBatchTimer = null;
          flushProfileBatch();
        }, 100);
      }
    };

    // Main event subscription
    this.subscription = this.rxNostr.use(this.rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        this.eventCount++;
        this.eventSubject.next({ event, signal: 'add' });
        queueProfileRequest(event.pubkey);
      },
    });

    // Profile subscription
    this.profileSubscription = this.rxNostr.use(this.profileRxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind !== 0) return;
        try {
          const profile = JSON.parse(event.content) as Profile;
          this.pendingProfiles.delete(event.pubkey);
          this.profileSubject.next({ pubkey: event.pubkey, profile });
        } catch {
          // Ignore parse errors
        }
      },
    });

    // Emit filters
    const filters = this.buildFilters();
    if (filters.length > 0) {
      this.rxReq.emit(filters as { kinds?: number[]; limit?: number }[]);
    }
  }

  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.profileSubscription) {
      this.profileSubscription.unsubscribe();
      this.profileSubscription = null;
    }
    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
      this.messageSubscription = null;
    }
    if (this.connectionStateSubscription) {
      this.connectionStateSubscription.unsubscribe();
      this.connectionStateSubscription = null;
    }
    if (this.rxNostr) {
      this.rxNostr.dispose();
      this.rxNostr = null;
    }
    this.rxReq = null;
    this.profileRxReq = null;
    this.pendingProfiles.clear();
    this.profileBatchQueue = [];
    if (this.profileBatchTimer) {
      clearTimeout(this.profileBatchTimer);
      this.profileBatchTimer = null;
    }
  }

  // Stop all subscriptions including trigger and relay input
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
  }

  isSubscribed(): boolean {
    return this.subscription !== null;
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
