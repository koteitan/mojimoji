import type { RxNostr } from 'rx-nostr';
import { createRxForwardReq } from 'rx-nostr';
import type { NostrEvent, Profile } from './types';
import { getCachedProfile, saveProfileToCache } from './profileCache';

type ForwardReq = ReturnType<typeof createRxForwardReq>;

/**
 * ProfileFetcher - Shared utility for batching profile (kind:0) requests
 *
 * Used by RelayNode and MultiTypeRelayNode to efficiently fetch user profiles.
 * Batches multiple pubkey requests and flushes them either when:
 * - Batch size reaches 50, or
 * - 100ms passes since last request
 */
export class ProfileFetcher {
  private rxNostr: RxNostr;
  private nodeId: string;
  private profileRxReq: ForwardReq | null = null;
  private profileSubscription: { unsubscribe: () => void } | null = null;
  private pendingProfiles = new Set<string>();
  private profileBatchQueue: string[] = [];
  private profileBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private onProfileReceived: ((pubkey: string, profile: Profile) => void) | null = null;

  constructor(rxNostr: RxNostr, nodeId: string) {
    this.rxNostr = rxNostr;
    this.nodeId = nodeId;
  }

  /**
   * Start the profile subscription
   * @param onProfileReceived Callback when a profile is received
   */
  start(onProfileReceived: (pubkey: string, profile: Profile) => void): void {
    this.onProfileReceived = onProfileReceived;
    this.profileRxReq = createRxForwardReq(`profile-${this.nodeId}`);

    this.profileSubscription = this.rxNostr.use(this.profileRxReq).subscribe({
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
    });
  }

  /**
   * Queue a profile request with batching
   * @param pubkey The pubkey to fetch profile for
   */
  queueRequest(pubkey: string): void {
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
      }, 100);
    }
  }

  /**
   * Flush the batch queue
   */
  private flushBatch(): void {
    if (this.profileBatchQueue.length === 0) return;
    const authors = [...this.profileBatchQueue];
    this.profileBatchQueue = [];
    this.profileRxReq?.emit({ kinds: [0], authors, limit: authors.length });
  }

  /**
   * Stop the profile subscription and clean up resources
   */
  stop(): void {
    if (this.profileSubscription) {
      this.profileSubscription.unsubscribe();
      this.profileSubscription = null;
    }
    this.profileRxReq = null;
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
