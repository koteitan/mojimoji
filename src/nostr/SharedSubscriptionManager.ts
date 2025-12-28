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
          // Broadcast to all subscribers
          for (const subscriber of relaySub.subscribers.values()) {
            subscriber.onEvent(event);
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
}

// Singleton instance
export const SharedSubscriptionManager = new SharedSubscriptionManagerClass();
