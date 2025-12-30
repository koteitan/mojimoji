import type { RxNostr } from 'rx-nostr';
import { createRxBackwardReq } from 'rx-nostr';
import type { NostrEvent, Profile } from './types';
import { getCachedProfile, saveProfileToCache } from './profileCache';
import { getRxNostr, getDefaultRelayUrl } from './nostr';

/**
 * ProfileFetcher - Shared utility for batching profile (kind:0) requests
 *
 * Used by SimpleRelayNode and ModularRelayNode to efficiently fetch user profiles.
 * Uses backward strategy (EOSE ends subscription) to avoid subscription accumulation.
 * Batches multiple pubkey requests and flushes them either when:
 * - Batch size reaches 50, or
 * - 1000ms passes since last request
 */
export class ProfileFetcher {
  private rxNostr: RxNostr;
  private nodeId: string;
  private pendingProfiles = new Set<string>();
  private profileBatchQueue: string[] = [];
  private profileBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private onProfileReceived: ((pubkey: string, profile: Profile) => void) | null = null;
  private isStarted = false;

  constructor(rxNostr: RxNostr, nodeId: string) {
    this.rxNostr = rxNostr;
    this.nodeId = nodeId;
  }

  /**
   * Start the profile fetcher
   * @param onProfileReceived Callback when a profile is received
   */
  start(onProfileReceived: (pubkey: string, profile: Profile) => void): void {
    this.onProfileReceived = onProfileReceived;
    this.isStarted = true;
  }

  /**
   * Queue a profile request with batching
   * @param pubkey The pubkey to fetch profile for
   */
  queueRequest(pubkey: string): void {
    if (!this.isStarted) return;
    if (getCachedProfile(pubkey) || this.pendingProfiles.has(pubkey)) return;
    this.pendingProfiles.add(pubkey);
    this.profileBatchQueue.push(pubkey);

    if (this.profileBatchQueue.length >= 50) {
      if (this.profileBatchTimer) {
        clearTimeout(this.profileBatchTimer);
        this.profileBatchTimer = null;
      }
      this.flushBatch();
    } else if (!this.profileBatchTimer) {
      this.profileBatchTimer = setTimeout(() => {
        this.profileBatchTimer = null;
        this.flushBatch();
      }, 1000);
    }
  }

  /**
   * Flush the batch queue using backward strategy (EOSE ends subscription)
   */
  private flushBatch(): void {
    if (this.profileBatchQueue.length === 0) return;
    const authors = [...this.profileBatchQueue];
    this.profileBatchQueue = [];

    // Create backward request - subscription ends on EOSE
    const rxReq = createRxBackwardReq();

    const subscription = this.rxNostr.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind !== 0) return;

        try {
          const profile = JSON.parse(event.content) as Profile;
          this.pendingProfiles.delete(event.pubkey);
          saveProfileToCache(event.pubkey, profile);
          this.onProfileReceived?.(event.pubkey, profile);
        } catch {
          // Ignore parse errors
        }
      },
      error: (err) => {
        console.error(`[ProfileFetcher ${this.nodeId.slice(0, 8)}] Subscription error:`, err);
      },
      complete: () => {
        // Backward request completes on EOSE - clean up
        subscription.unsubscribe();
      },
    });

    rxReq.emit({ kinds: [0], authors, limit: authors.length });
  }

  /**
   * Stop the profile fetcher and clean up resources
   */
  stop(): void {
    this.isStarted = false;
    this.pendingProfiles.clear();
    this.profileBatchQueue = [];
    if (this.profileBatchTimer) {
      clearTimeout(this.profileBatchTimer);
      this.profileBatchTimer = null;
    }
    this.onProfileReceived = null;
  }

  /**
   * Get the number of pending profile requests
   */
  getPendingCount(): number {
    return this.pendingProfiles.size;
  }
}

/**
 * GlobalProfileFetcher - Singleton ProfileFetcher for use by TimelineNode
 *
 * Uses the default relay for fetching profiles. This allows TimelineNode
 * to fetch profiles only for events that actually reach the timeline,
 * rather than fetching for all events at the relay level.
 */
class GlobalProfileFetcherClass {
  private profileFetcher: ProfileFetcher | null = null;
  private initialized = false;

  /**
   * Initialize the global profile fetcher
   * Should be called once on app startup
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const rxNostr = getRxNostr();
    rxNostr.setDefaultRelays([getDefaultRelayUrl()]);

    this.profileFetcher = new ProfileFetcher(rxNostr, 'global');
    this.profileFetcher.start(() => {
      // No-op callback - profiles are saved to cache by ProfileFetcher
    });
  }

  /**
   * Queue a profile request
   * Initializes the fetcher if not already done
   */
  queueRequest(pubkey: string): void {
    if (!this.initialized) {
      this.init();
    }
    this.profileFetcher?.queueRequest(pubkey);
  }

  /**
   * Get pending profile count
   */
  getPendingCount(): number {
    return this.profileFetcher?.getPendingCount() ?? 0;
  }
}

// Singleton instance
export const GlobalProfileFetcher = new GlobalProfileFetcherClass();
