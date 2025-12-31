// ReactionFetcher - Fetches reactions (kind:7) and reposts (kind:6) for events
// Similar to ProfileFetcher but for reactions/reposts

import { createRxBackwardReq } from 'rx-nostr';
import type { NostrEvent } from './types';
import { addReactionToCache, addRepostToCache, getCachedReactions } from './reactionCache';
import { getRxNostr, getDefaultRelayUrl } from './nostr';

// Nostr event kinds
const KIND_REPOST = 6;
const KIND_REACTION = 7;

/**
 * ReactionFetcher - Batches reaction/repost requests
 *
 * Uses backward strategy (EOSE ends subscription).
 * Batches multiple event ID requests and flushes them either when:
 * - Batch size reaches 50, or
 * - 1000ms passes since last request
 */
class ReactionFetcherClass {
  private pendingEventIds = new Set<string>();
  private batchQueue: string[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isStarted = false;

  /**
   * Start the reaction fetcher
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
  }

  /**
   * Queue a reaction/repost request with batching
   * @param eventId The event ID to fetch reactions for
   */
  queueRequest(eventId: string): void {
    if (!this.isStarted) {
      this.start();
    }

    // Skip if already cached or pending
    if (getCachedReactions(eventId) || this.pendingEventIds.has(eventId)) {
      return;
    }

    this.pendingEventIds.add(eventId);
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
      }, 1000);
    }
  }

  /**
   * Flush the batch queue using backward strategy
   */
  private flushBatch(): void {
    if (this.batchQueue.length === 0) return;

    const eventIds = [...this.batchQueue];
    this.batchQueue = [];

    console.log('[ReactionFetcher] Fetching reactions for', eventIds.length, 'events:', eventIds.slice(0, 3));

    const rxNostr = getRxNostr();
    const relayUrl = getDefaultRelayUrl();
    console.log('[ReactionFetcher] Using relay:', relayUrl);
    rxNostr.setDefaultRelays([relayUrl]);

    // Create backward request - subscription ends on EOSE
    const rxReq = createRxBackwardReq();

    const subscription = rxNostr.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        console.log('[ReactionFetcher] Received event:', event.kind, event.id.slice(0, 8));

        // Find which event this reaction/repost is for
        const targetEventId = this.findTargetEventId(event, eventIds);
        if (!targetEventId) {
          console.log('[ReactionFetcher] No matching target for event');
          return;
        }

        console.log('[ReactionFetcher] Adding', event.kind === KIND_REACTION ? 'reaction' : 'repost', 'to', targetEventId.slice(0, 8));

        if (event.kind === KIND_REACTION) {
          addReactionToCache(targetEventId, event);
        } else if (event.kind === KIND_REPOST) {
          addRepostToCache(targetEventId, event);
        }

        this.pendingEventIds.delete(targetEventId);
      },
      error: (err) => {
        console.error('[ReactionFetcher] Subscription error:', err);
      },
      complete: () => {
        console.log('[ReactionFetcher] Subscription complete (EOSE)');
        // Backward request completes on EOSE - clean up
        subscription.unsubscribe();
        // Mark remaining as processed (no reactions found)
        for (const eventId of eventIds) {
          this.pendingEventIds.delete(eventId);
        }
      },
    });

    // Emit filter for reactions and reposts
    rxReq.emit({
      kinds: [KIND_REPOST, KIND_REACTION],
      '#e': eventIds,
    });
    rxReq.over();
  }

  /**
   * Find which target event a reaction/repost is for
   */
  private findTargetEventId(event: NostrEvent, candidates: string[]): string | null {
    // Look for #e tag
    for (const tag of event.tags) {
      if (tag[0] === 'e' && candidates.includes(tag[1])) {
        return tag[1];
      }
    }
    return null;
  }

  /**
   * Stop the reaction fetcher
   */
  stop(): void {
    this.isStarted = false;
    this.pendingEventIds.clear();
    this.batchQueue = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Get the number of pending requests
   */
  getPendingCount(): number {
    return this.pendingEventIds.size;
  }
}

// Singleton instance
export const ReactionFetcher = new ReactionFetcherClass();
