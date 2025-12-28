import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextAreaControl, SelectControl, FilterControl, type Filters } from './controls';
import type { NostrEvent, Profile, EventSignal } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';
import { isNip07Available } from '../../../nostr/nip07';
import { fetchUserRelayList, getDefaultRelayUrl } from '../../../nostr/graphStorage';
import { ProfileFetcher } from '../../../nostr/ProfileFetcher';
import { SharedSubscriptionManager } from '../../../nostr/SharedSubscriptionManager';
import {
  getCachedProfile,
  findPubkeysByName,
  getProfileCacheInfo,
  getProfileCache,
} from '../../../nostr/profileCache';

// Re-export for backward compatibility
export { getCachedProfile, findPubkeysByName, getProfileCacheInfo };

const DEBUG = false;

// Default filters: kinds=[1], limit=200
const getDefaultFilters = (): Filters => [
  [
    { field: 'kinds', value: '1' },
    { field: 'limit', value: '200' },
  ],
];

// Resolve a single identifier value to hex
// Supports: bech32 (npub, note, nprofile, nevent), hex, name/display_name lookup
const resolveIdentifier = (
  value: string,
  field: string,
  findAllMatches: boolean = false
): string[] => {
  const trimmed = value.trim();
  if (!trimmed) return [];

  // 1. Try bech32 decode
  const decoded = decodeBech32ToHex(trimmed);
  if (decoded) {
    return [decoded.hex];
  }

  // 2. Check if it's already hex
  if (isHex64(trimmed)) {
    return [trimmed.toLowerCase()];
  }

  // 3. For pubkey fields (authors, #p), try name/display_name lookup
  if (field === 'authors' || field === '#p') {
    const matches: string[] = [];
    const searchLower = trimmed.toLowerCase();

    for (const [pubkey, profile] of getProfileCache()) {
      const name = profile.name?.toLowerCase() || '';
      const displayName = profile.display_name?.toLowerCase() || '';

      // Partial match on name or display_name
      if (name.includes(searchLower) || displayName.includes(searchLower)) {
        matches.push(pubkey);
        if (!findAllMatches) {
          break; // Return first match for tags
        }
      }
    }

    if (matches.length > 0) {
      return matches;
    }
  }

  // 4. Return as-is if nothing matched (might be a partial hex or unknown format)
  return [trimmed];
};

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
      } else if (field === 'ids') {
        // ids: support bech32 (note, nevent) and hex
        const resolved = value.split(',').flatMap((v) => resolveIdentifier(v, field, false));
        if (resolved.length > 0) {
          nostrFilter[field] = resolved;
        }
      } else if (field === 'authors') {
        // authors: support bech32 (npub, nprofile), hex, and name lookup (all matches)
        const resolved = value.split(',').flatMap((v) => resolveIdentifier(v, field, true));
        if (resolved.length > 0) {
          nostrFilter[field] = resolved;
        }
      } else if (field.startsWith('#')) {
        // Tag filters: support bech32 and name lookup (first match only)
        const resolved = value.split(',').flatMap((v) => resolveIdentifier(v, field, false));
        if (resolved.length > 0) {
          nostrFilter[field] = resolved;
        }
      } else if (field === 'since' || field === 'until') {
        // Support date formats (YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD) and unix timestamp
        const trimmedValue = value.trim();

        // Try date format first
        const timestamp = parseDateToTimestamp(trimmedValue);
        if (timestamp !== null) {
          nostrFilter[field] = timestamp;
        } else {
          // Fall back to integer parsing
          const num = parseInt(trimmedValue, 10);
          if (!isNaN(num)) {
            nostrFilter[field] = num;
          }
        }
      } else if (field === 'limit') {
        // Single integer
        const num = parseInt(value.trim(), 10);
        if (!isNaN(num)) {
          nostrFilter[field] = num;
        }
      }
    }
    return nostrFilter;
  }).filter((f) => Object.keys(f).length > 0);
};

// Relay source type: auto (from kind:10002) or manual (from textarea)
export type RelaySourceType = 'auto' | 'manual';

export class SimpleRelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'SimpleRelay';
  readonly nodeType = 'SimpleRelay';
  width = 280;
  height: number | undefined = undefined; // auto-calculated based on content

  private relaySource: RelaySourceType = 'auto';
  private relayUrls: string[] = [getDefaultRelayUrl()];
  private autoRelayUrls: string[] = []; // Cached relay URLs from kind:10002
  private filters: Filters = getDefaultFilters();

  // RxJS Observable for output events (with signal type)
  private eventSubject = new Subject<EventSignal>();
  private subscribedRelayUrls: string[] = [];  // Track which relays we're subscribed to

  // Profile updates - uses ProfileFetcher for batching
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();
  private profileFetchers: Map<string, ProfileFetcher> = new Map();  // Per-relay ProfileFetchers

  // Debug: event counters
  private eventCount = 0;
  private lastEventTime: number | null = null;
  private eoseReceived = false; // Track if EOSE has been received

  // Debug: monitoring flag (static so it applies to all instances)
  private static monitoring = false;

  // Shared observable that can be subscribed to by multiple downstream nodes
  public output$: Observable<EventSignal> = this.eventSubject.asObservable().pipe(share());

  // Observable for profile updates
  public profile$: Observable<{ pubkey: string; profile: Profile }> = this.profileSubject.asObservable().pipe(share());

  constructor() {
    super(i18next.t('nodes.relay.title'));

    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Events'));

    // Relay source type control
    this.addControl(
      'relaySource',
      new SelectControl(
        this.relaySource,
        i18next.t('nodes.relay.source'),
        [
          { value: 'auto', label: i18next.t('nodes.relay.sourceAuto') },
          { value: 'manual', label: i18next.t('nodes.relay.sourceManual') },
        ],
        (value) => {
          this.relaySource = value as RelaySourceType;
          // Update textarea disabled state
          const relaysControl = this.controls['relays'] as TextAreaControl;
          if (relaysControl) {
            relaysControl.disabled = value === 'auto';
          }
          if (value === 'auto') {
            this.loadAutoRelays();
          }
        }
      )
    );

    this.addControl(
      'relays',
      new TextAreaControl(
        this.relayUrls.join('\n'),
        i18next.t('nodes.relay.relays'),
        'wss://relay.example.com',
        (value) => {
          this.relayUrls = value.split('\n').filter(url => url.trim());
        },
        true // disabled by default (auto mode)
      )
    );

    // Load auto relays on initialization
    this.loadAutoRelays();

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

  // Load relay URLs from kind:10002 via NIP-07
  private async loadAutoRelays(): Promise<void> {
    if (!isNip07Available()) {
      if (DEBUG) console.log('NIP-07 not available, cannot load auto relays');
      return;
    }

    try {
      const relays = await fetchUserRelayList();
      if (relays.length > 0) {
        this.autoRelayUrls = relays;
        if (DEBUG) console.log('Auto relays loaded:', relays);
      }
    } catch (error) {
      if (DEBUG) console.error('Failed to load auto relays:', error);
    }
  }

  getRelayUrls(): string[] {
    // Return auto relays when source is 'auto' and we have cached auto relays
    if (this.relaySource === 'auto' && this.autoRelayUrls.length > 0) {
      return this.autoRelayUrls;
    }
    return this.relayUrls;
  }

  getRelaySource(): RelaySourceType {
    return this.relaySource;
  }

  getFilters(): Record<string, unknown>[] {
    return filtersToNostrFilters(this.filters);
  }

  serialize() {
    return {
      relaySource: this.relaySource,
      relayUrls: this.relayUrls,
      filters: this.filters,
    };
  }

  deserialize(data: { relaySource?: RelaySourceType; relayUrls: string[]; filters?: Filters; filterJson?: string }) {
    // Backward compatibility: default to 'manual' if relaySource is not present
    this.relaySource = data.relaySource || 'manual';
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

    // Update relay source control
    const relaySourceControl = this.controls['relaySource'] as SelectControl;
    if (relaySourceControl) {
      relaySourceControl.value = this.relaySource;
    }

    const relaysControl = this.controls['relays'] as TextAreaControl;
    if (relaysControl) {
      relaysControl.value = this.relayUrls.join('\n');
      relaysControl.disabled = this.relaySource === 'auto';
    }

    // If auto, load auto relays
    if (this.relaySource === 'auto') {
      this.loadAutoRelays();
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

    // Reset event counters
    this.eventCount = 0;
    this.lastEventTime = null;
    this.eoseReceived = false;

    const filters = this.getFilters();
    if (filters.length === 0) return;

    // Subscribe to each relay via SharedSubscriptionManager
    this.subscribedRelayUrls = [...this.relayUrls];
    for (const relayUrl of this.subscribedRelayUrls) {
      // Create ProfileFetcher for this relay using shared RxNostr
      const rxNostr = SharedSubscriptionManager.getRxNostr(relayUrl);
      const profileFetcher = new ProfileFetcher(rxNostr, `${this.id}-${relayUrl}`);
      profileFetcher.start((pubkey, profile) => {
        this.profileSubject.next({ pubkey, profile });
      });
      this.profileFetchers.set(relayUrl, profileFetcher);

      // Subscribe via SharedSubscriptionManager
      SharedSubscriptionManager.subscribe(
        relayUrl,
        this.id,
        filters,
        (event: NostrEvent) => {
          // Emit regular events with 'add' signal
          this.eventCount++;
          this.lastEventTime = Date.now();

          // Monitor: log event with JST timestamp
          if (SimpleRelayNode.monitoring) {
            const jst = new Date(event.created_at * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            const profile = getCachedProfile(event.pubkey);
            const name = profile?.name || profile?.display_name || event.pubkey.slice(0, 8);
            const content = event.content.slice(0, 50).replace(/\n/g, ' ');
            console.log(`[${jst}] ${name}: ${content}${event.content.length > 50 ? '...' : ''}`);
          }

          this.eventSubject.next({ event, signal: 'add' });

          // Queue profile request (batched) - use any available ProfileFetcher
          const pf = this.profileFetchers.get(relayUrl);
          pf?.queueRequest(event.pubkey);
        },
        () => {
          // EOSE callback
          this.eoseReceived = true;
        }
      );
    }
  }

  // Stop the nostr subscription
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
  }

  // Check if subscription is active
  isSubscribed(): boolean {
    return this.subscribedRelayUrls.length > 0;
  }

  // Force restart subscription (for debugging stuck connections)
  restartSubscription(): void {
    console.log(`[SimpleRelayNode ${this.id.slice(0, 8)}] Restarting subscription...`);
    this.startSubscription();
  }

  // Check if profile subscription is active
  isProfileSubscribed(): boolean {
    return this.profileFetchers.size > 0;
  }

  // Get pending profile count
  getPendingProfileCount(): number {
    let count = 0;
    for (const pf of this.profileFetchers.values()) {
      count += pf.getPendingCount();
    }
    return count;
  }

  // Get debug info for this node
  getDebugInfo(): {
    nodeId: string;
    subscribed: boolean;
    relayStatus: Record<string, string> | null;
    pendingProfiles: number;
    eventCount: number;
    lastEventAgo: string | null;
    eoseReceived: boolean;
  } {
    // Get relay status from shared RxNostr instances
    let relayStatus: Record<string, string> | null = null;
    if (this.subscribedRelayUrls.length > 0) {
      try {
        relayStatus = {};
        for (const relayUrl of this.subscribedRelayUrls) {
          const rxNostr = SharedSubscriptionManager.getRxNostr(relayUrl);
          const status = rxNostr.getAllRelayStatus();
          for (const [url, state] of Object.entries(status)) {
            relayStatus[url] = state.connection;
          }
        }
      } catch {
        // Ignore errors
      }
    }
    let lastEventAgo: string | null = null;
    if (this.lastEventTime) {
      const seconds = Math.floor((Date.now() - this.lastEventTime) / 1000);
      if (seconds < 60) {
        lastEventAgo = `${seconds}s ago`;
      } else if (seconds < 3600) {
        lastEventAgo = `${Math.floor(seconds / 60)}m ago`;
      } else {
        lastEventAgo = `${Math.floor(seconds / 3600)}h ago`;
      }
    }
    return {
      nodeId: this.id.slice(0, 8),
      subscribed: this.subscribedRelayUrls.length > 0,
      relayStatus,
      pendingProfiles: this.getPendingProfileCount(),
      eventCount: this.eventCount,
      lastEventAgo,
      eoseReceived: this.eoseReceived,
    };
  }

  // Toggle monitoring mode
  static startMonitoring(): void {
    SimpleRelayNode.monitoring = true;
    console.log('📡 Timeline monitoring started. Events will be logged in real-time.');
  }

  static stopMonitoring(): void {
    SimpleRelayNode.monitoring = false;
    console.log('📡 Timeline monitoring stopped.');
  }

  static isMonitoring(): boolean {
    return SimpleRelayNode.monitoring;
  }
}
