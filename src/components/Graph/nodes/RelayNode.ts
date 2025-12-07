import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextAreaControl, FilterControl, type Filters } from './controls';
import type { NostrEvent } from '../../../nostr/types';

// Type for the result of createRxForwardReq with emit method
type ForwardReq = ReturnType<typeof createRxForwardReq>;

// Get default relay URL based on locale
const getDefaultRelayUrl = (): string => {
  const lang = i18next.language || navigator.language || 'en';
  if (lang.startsWith('ja')) {
    return 'wss://yabu.me';
  }
  return 'wss://relay.damus.io';
};

// Default filters: kinds=[1], limit=200
const getDefaultFilters = (): Filters => [
  [
    { field: 'kinds', value: '1' },
    { field: 'limit', value: '200' },
  ],
];

// Convert Filters to nostr filter objects
const filtersToNostrFilters = (filters: Filters): Record<string, unknown>[] => {
  return filters.map((filter) => {
    const nostrFilter: Record<string, unknown> = {};
    for (const element of filter) {
      const { field, value } = element;
      if (!value.trim()) continue;

      // Parse value based on field type
      if (field === 'kinds') {
        // kinds is an array of integers
        nostrFilter[field] = value.split(',').map((v) => parseInt(v.trim(), 10)).filter((n) => !isNaN(n));
      } else if (field === 'ids' || field === 'authors' || field.startsWith('#')) {
        // Arrays of strings
        nostrFilter[field] = value.split(',').map((v) => v.trim()).filter((v) => v);
      } else if (field === 'since' || field === 'until' || field === 'limit') {
        // Single integers
        const num = parseInt(value.trim(), 10);
        if (!isNaN(num)) {
          nostrFilter[field] = num;
        }
      }
    }
    return nostrFilter;
  }).filter((f) => Object.keys(f).length > 0);
};

export class RelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'Relay';
  readonly nodeType = 'Relay';
  width = 280;
  height: number | undefined = undefined; // auto-calculated based on content

  private relayUrls: string[] = [getDefaultRelayUrl()];
  private filters: Filters = getDefaultFilters();

  // RxJS Observable for output events
  private eventSubject = new Subject<NostrEvent>();
  private rxNostr: RxNostr | null = null;
  private rxReq: ForwardReq | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Shared observable that can be subscribed to by multiple downstream nodes
  public output$: Observable<NostrEvent> = this.eventSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.relay.title'));

    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));

    this.addControl(
      'relays',
      new TextAreaControl(
        this.relayUrls.join('\n'),
        i18next.t('nodes.relay.relays'),
        'wss://relay.example.com',
        (value) => {
          this.relayUrls = value.split('\n').filter(url => url.trim());
        }
      )
    );

    this.addControl(
      'filter',
      new FilterControl(
        this.filters,
        i18next.t('nodes.relay.filter'),
        (filters) => {
          this.filters = filters;
        }
      )
    );
  }

  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  getFilters(): Record<string, unknown>[] {
    return filtersToNostrFilters(this.filters);
  }

  serialize() {
    return {
      relayUrls: this.relayUrls,
      filters: this.filters,
    };
  }

  deserialize(data: { relayUrls: string[]; filters?: Filters; filterJson?: string }) {
    this.relayUrls = data.relayUrls;

    // Handle backward compatibility: convert old filterJson to new filters format
    if (data.filters) {
      this.filters = data.filters;
    } else if (data.filterJson) {
      // Convert old JSON format to new Filters format
      try {
        const parsed = JSON.parse(data.filterJson);
        this.filters = [
          Object.entries(parsed).map(([field, value]) => ({
            field,
            value: Array.isArray(value) ? value.join(',') : String(value),
          })),
        ];
      } catch {
        this.filters = getDefaultFilters();
      }
    }

    const relaysControl = this.controls['relays'] as TextAreaControl;
    if (relaysControl) {
      relaysControl.value = this.relayUrls.join('\n');
    }

    const filterControl = this.controls['filter'] as FilterControl;
    if (filterControl) {
      filterControl.filters = this.filters;
    }
  }

  // Start the nostr subscription and emit events to the Subject
  startSubscription(): void {
    // Stop any existing subscription first
    this.stopSubscription();

    if (this.relayUrls.length === 0) return;

    this.rxNostr = createRxNostr({ verifier });
    this.rxNostr.setDefaultRelays(this.relayUrls);

    this.rxReq = createRxForwardReq();

    this.subscription = this.rxNostr.use(this.rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        this.eventSubject.next(event);
      },
      error: (err) => {
        console.error('RelayNode subscription error:', err);
      },
    });

    // Emit filters to start receiving events (multiple filters = OR logic)
    const filters = this.getFilters();
    for (const filter of filters) {
      this.rxReq.emit(filter as { kinds?: number[]; limit?: number });
    }
  }

  // Stop the nostr subscription
  stopSubscription(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.rxNostr) {
      this.rxNostr.dispose();
      this.rxNostr = null;
    }
    this.rxReq = null;
  }

  // Check if subscription is active
  isSubscribed(): boolean {
    return this.subscription !== null;
  }
}
