// Subscription Tracker - Central registry for all rx-nostr subscriptions
// Tracks subscription purposes, relay statuses, and errors

import type { RxNostr } from 'rx-nostr';

// Subscription purposes matching spec/nostr.md Subscriptions Table
export type SubscriptionPurpose =
  | 'get user relays'
  | 'load all graphs'
  | 'cache profiles for UI'
  | 'get owner relays'
  | 'load graph by nevent'
  | 'load graph by naddr'
  | 'get graph owner relays'
  | 'find graphs'
  | `node-${string}`;  // For relay nodes (truncated to 8 chars)

// Tracked subscription entry
interface TrackedSubscription {
  id: string;
  rxNostr: RxNostr;
  purpose: SubscriptionPurpose;
  relayUrls: string[];
  kinds: number[];  // Nostr event kinds being subscribed
  lastStatus: Map<string, string>;  // relay -> connection status
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

// Status entry for output
export interface StatusEntry {
  index: number;
  relay: string;
  kinds: number[];
  purpose: string;
  status: string;
  error: string | null;
}

class SubscriptionTrackerClass {
  private subscriptions: Map<string, TrackedSubscription> = new Map();

  /**
   * Register a new subscription
   */
  register(id: string, rxNostr: RxNostr, purpose: SubscriptionPurpose, relayUrls: string[], kinds: number[] = []): void {
    // Get initial status
    const lastStatus = new Map<string, string>();
    try {
      const allStatus = rxNostr.getAllRelayStatus();
      for (const [url, state] of Object.entries(allStatus)) {
        lastStatus.set(url, state.connection);
      }
    } catch {
      // rxNostr might not be fully initialized yet
      for (const url of relayUrls) {
        lastStatus.set(url, 'unknown');
      }
    }

    const entry: TrackedSubscription = {
      id,
      rxNostr,
      purpose,
      relayUrls,
      kinds,
      lastStatus,
      lastError: null,
      createdAt: new Date(),
      completedAt: null,
    };

    this.subscriptions.set(id, entry);
  }

  /**
   * Update status for a subscription (call periodically or on status change)
   */
  updateStatus(id: string): void {
    const entry = this.subscriptions.get(id);
    if (!entry) return;

    try {
      const allStatus = entry.rxNostr.getAllRelayStatus();
      for (const [url, state] of Object.entries(allStatus)) {
        entry.lastStatus.set(url, state.connection);
      }
    } catch {
      // Ignore errors during status update
    }
  }

  /**
   * Set error for a subscription
   */
  setError(id: string, error: string | null): void {
    const entry = this.subscriptions.get(id);
    if (entry) {
      entry.lastError = error;
    }
  }

  /**
   * Unregister a subscription (mark as completed but keep for history)
   */
  unregister(id: string): void {
    const entry = this.subscriptions.get(id);
    if (entry) {
      // Update final status before marking complete
      this.updateStatus(id);
      entry.completedAt = new Date();
    }
  }

  /**
   * Remove a subscription completely
   */
  remove(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Get all status entries
   */
  getAllStatus(): StatusEntry[] {
    const entries: StatusEntry[] = [];
    let index = 1;

    // Update all statuses first
    for (const [id] of this.subscriptions) {
      this.updateStatus(id);
    }

    // Collect entries
    for (const sub of this.subscriptions.values()) {
      for (const [relay, status] of sub.lastStatus) {
        entries.push({
          index: index++,
          relay,
          kinds: sub.kinds,
          purpose: sub.purpose,
          status: sub.completedAt ? `${status} (completed)` : status,
          error: sub.lastError,
        });
      }
    }

    return entries;
  }

  /**
   * Get status entries filtered by relay URL
   */
  getStatusForRelay(relayUrl: string): StatusEntry[] {
    const entries: StatusEntry[] = [];
    let index = 1;

    // Update all statuses first
    for (const [id] of this.subscriptions) {
      this.updateStatus(id);
    }

    // Collect entries for matching relay
    for (const sub of this.subscriptions.values()) {
      for (const [relay, status] of sub.lastStatus) {
        if (relay.includes(relayUrl) || relayUrl.includes(relay)) {
          entries.push({
            index: index++,
            relay,
            kinds: sub.kinds,
            purpose: sub.purpose,
            status: sub.completedAt ? `${status} (completed)` : status,
            error: sub.lastError,
          });
        }
      }
    }

    return entries;
  }

  /**
   * Clean up completed subscriptions (call manually via cleansub())
   * Returns the number of removed entries
   */
  cleanup(): number {
    const toRemove: string[] = [];

    for (const [id, sub] of this.subscriptions) {
      if (sub.completedAt) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.subscriptions.delete(id);
    }

    return toRemove.length;
  }

  /**
   * Get subscription count
   */
  getCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Dispose tracker
   */
  dispose(): void {
    this.subscriptions.clear();
  }
}

// Export singleton instance
export const SubscriptionTracker = new SubscriptionTrackerClass();
