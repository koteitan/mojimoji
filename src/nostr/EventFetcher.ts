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
  private initialized = false;

  /**
   * Queue an event fetch request
   * @param eventId The event ID (hex) to fetch
   * @param callback Called when the event is fetched (or null if not found)
   */
  queueRequest(eventId: string, callback: (event: NostrEvent | null) => void): void {
    if (!this.initialized) {
      this.init();
    }

    // Check cache first
    const cached = getCachedEvent(eventId);
    if (cached) {
      // Call callback immediately with cached event
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

    rxReq.emit({ ids, limit: ids.length });
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
