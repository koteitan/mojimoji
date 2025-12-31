import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import type { NostrEvent } from './types';

type Filter = Record<string, unknown>;
type ForwardReq = ReturnType<typeof createRxForwardReq>;

interface Subscriber {
  nodeId: string;
  filters: Filter[];
  onEvent: (event: NostrEvent) => void;
  onEose?: () => void;
}

interface RelaySubscription {
  rxNostr: RxNostr;
  rxReq: ForwardReq;
  subscribers: Map<string, Subscriber>;  // nodeId -> Subscriber
  subscription: { unsubscribe: () => void } | null;
  messageSubscription: { unsubscribe: () => void } | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * SharedSubscriptionManager - Manages shared subscriptions per relay URL
 *
 * Multiple nodes can subscribe to the same relay with different filters.
 * Filters are combined into one REQ (multiple filters, not merged).
 * Events are broadcast to all subscribers.
 */
class SharedSubscriptionManagerClass {
  private relaySubscriptions: Map<string, RelaySubscription> = new Map();
  private static DEBOUNCE_MS = 100;  // Debounce filter updates

  /**
   * Subscribe to a relay with filters
   * @param relayUrl The relay URL to subscribe to
   * @param nodeId Unique identifier for the subscriber node
   * @param filters The filters to apply
   * @param onEvent Callback when an event is received
   * @param onEose Optional callback when EOSE is received
   */
  subscribe(
    relayUrl: string,
    nodeId: string,
    filters: Filter[],
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void
  ): void {
    let relaySub = this.relaySubscriptions.get(relayUrl);

    if (!relaySub) {
      // Create new relay subscription
      const rxNostr = createRxNostr({ verifier });
      rxNostr.setDefaultRelays([relayUrl]);
      const rxReq = createRxForwardReq(`shared-${this.hashRelayUrl(relayUrl)}`);

      relaySub = {
        rxNostr,
        rxReq,
        subscribers: new Map(),
        subscription: null,
        messageSubscription: null,
        debounceTimer: null,
      };
      this.relaySubscriptions.set(relayUrl, relaySub);
    }

    // Add/update subscriber
    relaySub.subscribers.set(nodeId, { nodeId, filters, onEvent, onEose });

    // Debounce filter update
    this.scheduleFilterUpdate(relayUrl);
  }

  /**
   * Update filters for an existing subscription
   */
  updateFilters(relayUrl: string, nodeId: string, filters: Filter[]): void {
    const relaySub = this.relaySubscriptions.get(relayUrl);
    if (!relaySub) return;

    const subscriber = relaySub.subscribers.get(nodeId);
    if (!subscriber) return;

    subscriber.filters = filters;
    this.scheduleFilterUpdate(relayUrl);
  }

  /**
   * Unsubscribe a node from a relay
   */
  unsubscribe(relayUrl: string, nodeId: string): void {
    const relaySub = this.relaySubscriptions.get(relayUrl);
    if (!relaySub) return;

    relaySub.subscribers.delete(nodeId);

    if (relaySub.subscribers.size === 0) {
      // No more subscribers, clean up
      this.cleanupRelaySubscription(relayUrl);
    } else {
      // Update filters without this subscriber
      this.scheduleFilterUpdate(relayUrl);
    }
  }

  /**
   * Schedule a filter update with debouncing
   */
  private scheduleFilterUpdate(relayUrl: string): void {
    const relaySub = this.relaySubscriptions.get(relayUrl);
    if (!relaySub) return;

    if (relaySub.debounceTimer) {
      clearTimeout(relaySub.debounceTimer);
    }

    relaySub.debounceTimer = setTimeout(() => {
      relaySub.debounceTimer = null;
      this.applyFilters(relayUrl);
    }, SharedSubscriptionManagerClass.DEBOUNCE_MS);
  }

  /**
   * Apply combined filters to the relay subscription
   */
  private applyFilters(relayUrl: string): void {
    const relaySub = this.relaySubscriptions.get(relayUrl);
    if (!relaySub) return;

    // Collect all filters from all subscribers
    const allFilters: Filter[] = [];
    for (const subscriber of relaySub.subscribers.values()) {
      allFilters.push(...subscriber.filters);
    }

    if (allFilters.length === 0) {
      return;
    }

    // Start subscription if not already running
    if (!relaySub.subscription) {
      // Monitor EOSE
      relaySub.messageSubscription = relaySub.rxNostr.createAllMessageObservable().subscribe({
        next: (packet) => {
          if (packet.type === 'EOSE') {
            // Notify all subscribers
            for (const subscriber of relaySub.subscribers.values()) {
              subscriber.onEose?.();
            }
          }
        },
      });

      // Main subscription
      relaySub.subscription = relaySub.rxNostr.use(relaySub.rxReq).subscribe({
        next: (packet) => {
          const event = packet.event as NostrEvent;
          // Only send to subscribers whose filters match
          for (const subscriber of relaySub.subscribers.values()) {
            if (this.eventMatchesFilters(event, subscriber.filters)) {
              subscriber.onEvent(event);
            }
          }
        },
        error: (err) => {
          console.error(`[SharedSubscriptionManager] Error for ${relayUrl}:`, err);
        },
      });
    }

    // Emit combined filters
    relaySub.rxReq.emit(allFilters as { kinds?: number[]; limit?: number }[]);
  }

  /**
   * Clean up a relay subscription
   */
  private cleanupRelaySubscription(relayUrl: string): void {
    const relaySub = this.relaySubscriptions.get(relayUrl);
    if (!relaySub) return;

    if (relaySub.debounceTimer) {
      clearTimeout(relaySub.debounceTimer);
    }
    if (relaySub.subscription) {
      relaySub.subscription.unsubscribe();
    }
    if (relaySub.messageSubscription) {
      relaySub.messageSubscription.unsubscribe();
    }
    relaySub.rxNostr.dispose();

    this.relaySubscriptions.delete(relayUrl);
  }

  /**
   * Get RxNostr instance for a relay URL (for ProfileFetcher)
   * Creates one if it doesn't exist
   */
  getRxNostr(relayUrl: string): RxNostr {
    let relaySub = this.relaySubscriptions.get(relayUrl);

    if (!relaySub) {
      const rxNostr = createRxNostr({ verifier });
      rxNostr.setDefaultRelays([relayUrl]);
      const rxReq = createRxForwardReq(`shared-${this.hashRelayUrl(relayUrl)}`);

      relaySub = {
        rxNostr,
        rxReq,
        subscribers: new Map(),
        subscription: null,
        messageSubscription: null,
        debounceTimer: null,
      };
      this.relaySubscriptions.set(relayUrl, relaySub);
    }

    return relaySub.rxNostr;
  }

  /**
   * Get subscription info for debugging
   */
  getInfo(): { relayUrl: string; subscriberCount: number; filterCount: number }[] {
    const info: { relayUrl: string; subscriberCount: number; filterCount: number }[] = [];
    for (const [relayUrl, relaySub] of this.relaySubscriptions) {
      let filterCount = 0;
      for (const subscriber of relaySub.subscribers.values()) {
        filterCount += subscriber.filters.length;
      }
      info.push({
        relayUrl,
        subscriberCount: relaySub.subscribers.size,
        filterCount,
      });
    }
    return info;
  }

  /**
   * Get relay status entries for dumpSub() - returns all relay/node combinations with status
   */
  getRelayStatusEntries(): { relay: string; kinds: number[]; purpose: string; status: string; error: string | null }[] {
    const entries: { relay: string; kinds: number[]; purpose: string; status: string; error: string | null }[] = [];

    for (const [relayUrl, relaySub] of this.relaySubscriptions) {
      // Get relay status from rxNostr
      let status = 'unknown';
      try {
        const allStatus = relaySub.rxNostr.getAllRelayStatus();
        // Try both with and without trailing slash
        const normalizedUrl = relayUrl.replace(/\/$/, '');
        const relayState = allStatus[relayUrl] || allStatus[normalizedUrl] || allStatus[normalizedUrl + '/'];
        if (relayState) {
          status = relayState.connection;
        }
      } catch {
        status = 'error';
      }

      // Create entry for each subscriber node
      for (const subscriber of relaySub.subscribers.values()) {
        const truncatedId = subscriber.nodeId.slice(0, 8);
        // Extract unique kinds from subscriber's filters
        const kindsSet = new Set<number>();
        for (const filter of subscriber.filters) {
          if (filter.kinds && Array.isArray(filter.kinds)) {
            for (const k of filter.kinds as number[]) {
              kindsSet.add(k);
            }
          }
        }
        entries.push({
          relay: relayUrl,
          kinds: Array.from(kindsSet).sort((a, b) => a - b),
          purpose: `node-${truncatedId}`,
          status,
          error: null,
        });
      }
    }

    return entries;
  }

  /**
   * Hash relay URL for subscription ID
   */
  private hashRelayUrl(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if an event matches any of the subscriber's filters
   */
  private eventMatchesFilters(event: NostrEvent, filters: Filter[]): boolean {
    // If no filters, match everything
    if (filters.length === 0) return true;

    // Event matches if it matches ANY filter (OR logic)
    return filters.some((filter) => this.eventMatchesFilter(event, filter));
  }

  /**
   * Check if an event matches a single filter
   */
  private eventMatchesFilter(event: NostrEvent, filter: Filter): boolean {
    // Check kinds
    if (filter.kinds !== undefined) {
      const kinds = filter.kinds as number[];
      if (!kinds.includes(event.kind)) return false;
    }

    // Check ids
    if (filter.ids !== undefined) {
      const ids = filter.ids as string[];
      if (!ids.includes(event.id)) return false;
    }

    // Check authors
    if (filter.authors !== undefined) {
      const authors = filter.authors as string[];
      if (!authors.includes(event.pubkey)) return false;
    }

    // Check since
    if (filter.since !== undefined) {
      const since = filter.since as number;
      if (event.created_at < since) return false;
    }

    // Check until
    if (filter.until !== undefined) {
      const until = filter.until as number;
      if (event.created_at > until) return false;
    }

    // Check tag filters (#e, #p, #t, etc.)
    for (const key of Object.keys(filter)) {
      if (key.startsWith('#')) {
        const tagName = key.slice(1);
        const filterValues = filter[key] as string[];
        const eventTagValues = event.tags
          .filter((t) => t[0] === tagName)
          .map((t) => t[1]);

        // Event must have at least one matching tag value
        if (!filterValues.some((v) => eventTagValues.includes(v))) {
          return false;
        }
      }
    }

    // limit is not a matching criterion (it's a count limit)
    // All criteria passed
    return true;
  }
}

// Singleton instance
export const SharedSubscriptionManager = new SharedSubscriptionManagerClass();
