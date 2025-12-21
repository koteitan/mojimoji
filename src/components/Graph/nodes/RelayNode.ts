import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextAreaControl, SelectControl, FilterControl, type Filters } from './controls';
import type { NostrEvent, Profile, EventSignal } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';
import { isNip07Available, getPubkey } from '../../../nostr/nip07';
import { fetchUserRelays } from '../../../nostr/graphStorage';

const DEBUG = false;

// Global profile cache shared across all RelayNodes
const PROFILE_CACHE_KEY = 'mojimoji-profile-cache';
const profileCache = new Map<string, Profile>();

// Load cache from localStorage on startup
function loadProfileCache(): void {
  try {
    const stored = localStorage.getItem(PROFILE_CACHE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as Record<string, Profile>;
      for (const [pubkey, profile] of Object.entries(data)) {
        profileCache.set(pubkey, profile);
      }
    }
  } catch {
    // Ignore errors when loading cache
  }
}

// Save cache to localStorage (debounced to avoid excessive writes)
let saveProfileCacheTimer: ReturnType<typeof setTimeout> | null = null;

function saveProfileCache(): void {
  // Debounce: wait 500ms after last call before actually saving
  if (saveProfileCacheTimer) {
    clearTimeout(saveProfileCacheTimer);
  }
  saveProfileCacheTimer = setTimeout(() => {
    saveProfileCacheTimer = null;
    try {
      const data: Record<string, Profile> = {};
      for (const [pubkey, profile] of profileCache) {
        data[pubkey] = profile;
      }
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
      if (DEBUG) console.log('Profile cache saved to localStorage');
    } catch {
      // Ignore errors when saving cache (e.g., quota exceeded)
    }
  }, 500);
}

// Initialize cache from localStorage
loadProfileCache();

export function getCachedProfile(pubkey: string): Profile | undefined {
  return profileCache.get(pubkey);
}

// Find pubkeys by name/display_name partial match (all matches)
export function findPubkeysByName(searchTerm: string): string[] {
  const results: string[] = [];
  const searchLower = searchTerm.toLowerCase();

  for (const [pubkey, profile] of profileCache) {
    const name = profile.name?.toLowerCase() || '';
    const displayName = profile.display_name?.toLowerCase() || '';
    if (name.includes(searchLower) || displayName.includes(searchLower)) {
      results.push(pubkey);
    }
  }

  return results;
}

// Get cache info for debugging
export function getProfileCacheInfo(): { count: number; bytes: number } {
  const data: Record<string, Profile> = {};
  for (const [pubkey, profile] of profileCache) {
    data[pubkey] = profile;
  }
  const json = JSON.stringify(data);
  return {
    count: profileCache.size,
    bytes: new Blob([json]).size,
  };
}

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

    for (const [pubkey, profile] of profileCache) {
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

export class RelayNode extends ClassicPreset.Node {
  static readonly nodeType = 'Relay';
  readonly nodeType = 'Relay';
  width = 280;
  height: number | undefined = undefined; // auto-calculated based on content

  private relaySource: RelaySourceType = 'auto';
  private relayUrls: string[] = [getDefaultRelayUrl()];
  private autoRelayUrls: string[] = []; // Cached relay URLs from kind:10002
  private filters: Filters = getDefaultFilters();

  // RxJS Observable for output events (with signal type)
  private eventSubject = new Subject<EventSignal>();
  private rxNostr: RxNostr | null = null;
  private rxReq: ForwardReq | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  // Profile updates - separate rxReq to avoid overwriting main subscription
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();
  private profileRxReq: ForwardReq | null = null;
  private profileSubscription: { unsubscribe: () => void } | null = null;
  private pendingProfiles = new Set<string>(); // Track pubkeys we've already requested
  private profileBatchQueue: string[] = []; // Queue for batching profile requests
  private profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

  // Debug: event counters
  private eventCount = 0;
  private lastEventTime: number | null = null;
  private eoseReceived = false; // Track if EOSE has been received

  // Debug: monitoring flag (static so it applies to all instances)
  private static monitoring = false;

  // Connection state and EOSE monitoring subscriptions
  private messageSubscription: { unsubscribe: () => void } | null = null;
  private connectionStateSubscription: { unsubscribe: () => void } | null = null;

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
      const pubkey = await getPubkey();
      const relays = await fetchUserRelays(pubkey);
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

    this.rxNostr = createRxNostr({ verifier });
    this.rxNostr.setDefaultRelays(this.relayUrls);

    // Use node ID as subscription ID to avoid conflicts when multiple nodes use the same relay
    this.rxReq = createRxForwardReq(`relay-${this.id}`);

    // Monitor all messages to detect EOSE and CLOSED
    this.messageSubscription = this.rxNostr.createAllMessageObservable().subscribe({
      next: (packet) => {
        if (packet.type === 'EOSE') {
          this.eoseReceived = true;
          console.log(`[RelayNode ${this.id.slice(0, 8)}] EOSE received from ${packet.from}`);
        } else if (packet.type === 'CLOSED') {
          console.warn(`[RelayNode ${this.id.slice(0, 8)}] CLOSED received from ${packet.from}: ${(packet as { notice?: string }).notice || 'no reason'}`);
        }
      },
    });

    // Monitor connection state changes
    this.connectionStateSubscription = this.rxNostr.createConnectionStateObservable().subscribe({
      next: (packet) => {
        console.log(`[RelayNode ${this.id.slice(0, 8)}] Connection state: ${packet.from} -> ${packet.state}`);
      },
    });

    // Create separate rxReq for profile requests to avoid overwriting main subscription
    this.profileRxReq = createRxForwardReq(`profile-${this.id}`);

    // Helper to flush profile batch queue - uses separate profileRxReq
    const flushProfileBatch = () => {
      if (this.profileBatchQueue.length === 0) return;
      const authors = [...this.profileBatchQueue];
      this.profileBatchQueue = [];
      if (DEBUG) console.log('Batch requesting profiles for:', authors.length, 'authors');
      this.profileRxReq?.emit({ kinds: [0], authors, limit: authors.length });
    };

    // Helper to queue profile request with batching
    const queueProfileRequest = (pubkey: string) => {
      if (profileCache.has(pubkey) || this.pendingProfiles.has(pubkey)) return;
      this.pendingProfiles.add(pubkey);
      this.profileBatchQueue.push(pubkey);

      // Flush immediately if batch is large enough, or schedule flush
      if (this.profileBatchQueue.length >= 50) {
        if (this.profileBatchTimer) {
          clearTimeout(this.profileBatchTimer);
          this.profileBatchTimer = null;
        }
        flushProfileBatch();
      } else if (!this.profileBatchTimer) {
        // Flush after 100ms if no more events arrive
        this.profileBatchTimer = setTimeout(() => {
          this.profileBatchTimer = null;
          flushProfileBatch();
        }, 100);
      }
    };

    // Main event subscription (handles regular events only)
    this.subscription = this.rxNostr.use(this.rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;

        // Emit regular events with 'add' signal
        this.eventCount++;
        this.lastEventTime = Date.now();

        // Monitor: log event with JST timestamp
        if (RelayNode.monitoring) {
          const jst = new Date(event.created_at * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
          const profile = profileCache.get(event.pubkey);
          const name = profile?.name || profile?.display_name || event.pubkey.slice(0, 8);
          const content = event.content.slice(0, 50).replace(/\n/g, ' ');
          console.log(`[${jst}] ${name}: ${content}${event.content.length > 50 ? '...' : ''}`);
        }

        this.eventSubject.next({ event, signal: 'add' });

        // Queue profile request (batched)
        queueProfileRequest(event.pubkey);
      },
      error: (err) => {
        console.error(`[RelayNode ${this.id.slice(0, 8)}] Subscription error:`, err);
      },
      complete: () => {
        console.warn(`[RelayNode ${this.id.slice(0, 8)}] Subscription completed unexpectedly`);
      },
    });

    // Separate profile subscription using profileRxReq
    this.profileSubscription = this.rxNostr.use(this.profileRxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind !== 0) return; // Only handle profile events

        if (DEBUG) console.log('Profile event received:', event.kind, event.pubkey.slice(0, 8));
        try {
          const profile = JSON.parse(event.content) as Profile;
          profileCache.set(event.pubkey, profile);
          this.pendingProfiles.delete(event.pubkey); // Remove from pending
          saveProfileCache(); // Persist to localStorage
          if (DEBUG) console.log('Profile cached:', event.pubkey.slice(0, 8), profile.name || profile.display_name);
          this.profileSubject.next({ pubkey: event.pubkey, profile });
        } catch (e) {
          if (DEBUG) console.error('Profile parse error:', e);
        }
      },
      error: (err) => {
        console.error(`[RelayNode ${this.id.slice(0, 8)}] Profile subscription error:`, err);
      },
      complete: () => {
        console.warn(`[RelayNode ${this.id.slice(0, 8)}] Profile subscription completed unexpectedly`);
      },
    });

    // Emit filters to start receiving events (multiple filters = OR logic)
    // NOTE: emit() must be called once with all filters, not in a loop
    // In forward strategy, each emit() overwrites the previous subscription
    const filters = this.getFilters();
    if (filters.length > 0) {
      this.rxReq.emit(filters as { kinds?: number[]; limit?: number }[]);
    }
  }

  // Stop the nostr subscription
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

  // Check if subscription is active
  isSubscribed(): boolean {
    return this.subscription !== null;
  }

  // Force restart subscription (for debugging stuck connections)
  restartSubscription(): void {
    console.log(`[RelayNode ${this.id.slice(0, 8)}] Restarting subscription...`);
    this.startSubscription();
  }

  // Check if profile subscription is active
  isProfileSubscribed(): boolean {
    return this.profileSubscription !== null;
  }

  // Get pending profile count
  getPendingProfileCount(): number {
    return this.pendingProfiles.size;
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
    let relayStatus: Record<string, string> | null = null;
    if (this.rxNostr) {
      try {
        const status = this.rxNostr.getAllRelayStatus();
        relayStatus = {};
        for (const [url, state] of Object.entries(status)) {
          // RelayStatus has a 'connection' property that is the ConnectionState string
          relayStatus[url] = state.connection;
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
      subscribed: this.subscription !== null,
      relayStatus,
      pendingProfiles: this.pendingProfiles.size,
      eventCount: this.eventCount,
      lastEventAgo,
      eoseReceived: this.eoseReceived,
    };
  }

  // Toggle monitoring mode
  static startMonitoring(): void {
    RelayNode.monitoring = true;
    console.log('📡 Timeline monitoring started. Events will be logged in real-time.');
  }

  static stopMonitoring(): void {
    RelayNode.monitoring = false;
    console.log('📡 Timeline monitoring stopped.');
  }

  static isMonitoring(): boolean {
    return RelayNode.monitoring;
  }
}
