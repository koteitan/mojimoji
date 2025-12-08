import { ClassicPreset } from 'rete';
import { Subject, Observable, share } from 'rxjs';
import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import i18next from 'i18next';
import { eventSocket } from './types';
import { TextAreaControl, FilterControl, type Filters } from './controls';
import type { NostrEvent, Profile } from '../../../nostr/types';
import { decodeBech32ToHex, isHex64, parseDateToTimestamp } from '../../../nostr/types';

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

  // Profile updates (kind:0 events handled in main subscription)
  private profileSubject = new Subject<{ pubkey: string; profile: Profile }>();
  private profileSubscription: { unsubscribe: () => void } | null = null;
  private pendingProfiles = new Set<string>(); // Track pubkeys we've already requested
  private profileBatchQueue: string[] = []; // Queue for batching profile requests
  private profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

  // Shared observable that can be subscribed to by multiple downstream nodes
  public output$: Observable<NostrEvent> = this.eventSubject.asObservable().pipe(share());

  // Observable for profile updates
  public profile$: Observable<{ pubkey: string; profile: Profile }> = this.profileSubject.asObservable().pipe(share());

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

    // Helper to flush profile batch queue
    const flushProfileBatch = () => {
      if (this.profileBatchQueue.length === 0) return;
      const authors = [...this.profileBatchQueue];
      this.profileBatchQueue = [];
      if (DEBUG) console.log('Batch requesting profiles for:', authors.length, 'authors');
      this.rxReq?.emit({ kinds: [0], authors, limit: authors.length });
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

    // Main event subscription (handles both regular events and profile events)
    this.subscription = this.rxNostr.use(this.rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;

        // Handle profile events (kind:0)
        if (event.kind === 0) {
          if (DEBUG) console.log('Profile event received:', event.kind, event.pubkey.slice(0, 8));
          try {
            const profile = JSON.parse(event.content) as Profile;
            profileCache.set(event.pubkey, profile);
            saveProfileCache(); // Persist to localStorage
            if (DEBUG) console.log('Profile cached:', event.pubkey.slice(0, 8), profile.name || profile.display_name);
            this.profileSubject.next({ pubkey: event.pubkey, profile });
          } catch (e) {
            if (DEBUG) console.error('Profile parse error:', e);
          }
          return; // Don't emit profile events to the main output
        }

        // Emit regular events
        this.eventSubject.next(event);

        // Queue profile request (batched)
        queueProfileRequest(event.pubkey);
      },
      error: (err) => {
        if (DEBUG) console.error('RelayNode subscription error:', err);
      },
    });

    // Profile subscription is now merged with main subscription
    this.profileSubscription = { unsubscribe: () => {} }; // Dummy for cleanup

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
    if (this.profileSubscription) {
      this.profileSubscription.unsubscribe();
      this.profileSubscription = null;
    }
    if (this.rxNostr) {
      this.rxNostr.dispose();
      this.rxNostr = null;
    }
    this.rxReq = null;
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

  // Check if profile subscription is active
  isProfileSubscribed(): boolean {
    return this.profileSubscription !== null;
  }

  // Get pending profile count
  getPendingProfileCount(): number {
    return this.pendingProfiles.size;
  }
}
