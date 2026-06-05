import { createRxBackwardReq } from 'rx-nostr';
import type { NostrEvent } from './types';
import { getRxNostr, getDefaultRelayUrl } from './nostr';
import { getCachedEvent, saveEventToCache } from './eventCache';

/**
 * EventFetcher - Batch fetcher for referenced events (quote/reply/repost/reaction)
 *
 * Uses an in-memory cache to avoid re-fetching the same event multiple times
 * (common with reactions where many react to the same event).
 *
 * Batches are flushed when:
 * - Batch size reaches 50, or
 * - 500ms passes since last request
 */
class EventFetcherClass {
  private pendingIds = new Set<string>();
  private batchQueue: string[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks = new Map<string, ((event: NostrEvent | null) => void)[]>();
  private relayHints = new Map<string, Set<string>>();
  private initialized = false;

  /**
   * Queue an event fetch request
   * @param eventId The event ID (hex) to fetch
   * @param callback Called when the event is fetched (or null if not found)
   * @param relayHint Optional relay hint (from e/q tag) to query in addition to default relays
   */
  queueRequest(eventId: string, callback: (event: NostrEvent | null) => void, relayHint?: string): void {
    if (!this.initialized) {
      this.init();
    }

    // Record relay hint (even for cached/pending events it is harmless to drop)
    if (relayHint) {
      const hints = this.relayHints.get(eventId) || new Set<string>();
      hints.add(relayHint);
      this.relayHints.set(eventId, hints);
    }

    // Check cache first
    const cached = getCachedEvent(eventId);
    if (cached) {
      // Call callback immediately with cached event
      this.relayHints.delete(eventId);
      callback(cached);
      return;
    }

    // Store callback
    const existing = this.callbacks.get(eventId) || [];
    existing.push(callback);
    this.callbacks.set(eventId, existing);

    // Skip if already pending
    if (this.pendingIds.has(eventId)) return;

    this.pendingIds.add(eventId);
    this.batchQueue.push(eventId);

    if (this.batchQueue.length >= 50) {
      if (this.batchTimer) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      this.flushBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        this.flushBatch();
      }, 500);
    }
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const rxNostr = getRxNostr();
    rxNostr.setDefaultRelays([getDefaultRelayUrl()]);
  }

  private flushBatch(): void {
    if (this.batchQueue.length === 0) return;

    const ids = [...this.batchQueue];
    this.batchQueue = [];

    // Group hinted ids by relay so each hint relay is queried for its ids.
    // Hint relays are queried in addition to the default relays (emitted below).
    const idsByHintRelay = new Map<string, string[]>();
    for (const id of ids) {
      const hints = this.relayHints.get(id);
      if (hints) {
        for (const relay of hints) {
          const arr = idsByHintRelay.get(relay) || [];
          arr.push(id);
          idsByHintRelay.set(relay, arr);
        }
      }
      this.relayHints.delete(id);
    }

    const rxNostr = getRxNostr();
    const rxReq = createRxBackwardReq();
    const foundIds = new Set<string>();

    const subscription = rxNostr.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        foundIds.add(event.id);
        this.pendingIds.delete(event.id);

        // Save to cache
        saveEventToCache(event);

        // Call all callbacks for this event
        const cbs = this.callbacks.get(event.id);
        if (cbs) {
          cbs.forEach(cb => cb(event));
          this.callbacks.delete(event.id);
        }
      },
      error: (err) => {
        console.error('[EventFetcher] Subscription error:', err);
        // Call callbacks with null for unfound events
        ids.forEach(id => {
          if (!foundIds.has(id)) {
            const cbs = this.callbacks.get(id);
            if (cbs) {
              cbs.forEach(cb => cb(null));
              this.callbacks.delete(id);
            }
            this.pendingIds.delete(id);
          }
        });
      },
      complete: () => {
        subscription.unsubscribe();
        // Call callbacks with null for unfound events
        ids.forEach(id => {
          if (!foundIds.has(id)) {
            const cbs = this.callbacks.get(id);
            if (cbs) {
              cbs.forEach(cb => cb(null));
              this.callbacks.delete(id);
            }
            this.pendingIds.delete(id);
          }
        });
      },
    });

    // Query default relays for all ids
    rxReq.emit({ ids, limit: ids.length });

    // Additionally query each relay hint for the ids that referenced it
    for (const [relay, relayIds] of idsByHintRelay) {
      rxReq.emit({ ids: relayIds, limit: relayIds.length }, { relays: [relay] });
    }
  }

  /**
   * Get the number of pending requests
   */
  getPendingCount(): number {
    return this.pendingIds.size;
  }
}

// Singleton instance
export const EventFetcher = new EventFetcherClass();
