import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr, RxReq } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import type { Subscription } from 'rxjs';
import type { NostrEvent, Profile, TimelineEvent } from './types';

// Profile cache
const profileCache = new Map<string, Profile>();

// Singleton rx-nostr instance
let rxNostr: RxNostr | null = null;

function getRxNostr(): RxNostr {
  if (!rxNostr) {
    rxNostr = createRxNostr({
      verifier,
    });
  }
  return rxNostr;
}

interface SubscriptionHandle {
  subscription: Subscription;
  rxReq: RxReq<'forward'>;
  profileSubscription: Subscription | null;
  profileReq: RxReq<'forward'> | null;
}

const activeSubscriptions = new Map<string, SubscriptionHandle>();

export function subscribeToEvents(
  timelineNodeId: string,
  relayUrls: string[],
  filter: Record<string, unknown>,
  onEvent: (event: TimelineEvent) => void,
  onEose?: () => void
): void {
  // Cancel existing subscription for this timeline node
  unsubscribe(timelineNodeId);

  const client = getRxNostr();
  client.setDefaultRelays(relayUrls);

  const rxReq = createRxForwardReq();
  const profileReq = createRxForwardReq();

  // Main event subscription
  const subscription = client.use(rxReq).subscribe({
    next: (packet) => {
      const event = packet.event as NostrEvent;

      // Handle profile events (kind 0)
      if (event.kind === 0) {
        try {
          const profile = JSON.parse(event.content) as Profile;
          profileCache.set(event.pubkey, profile);
        } catch {
          // Ignore invalid profile content
        }
        return;
      }

      // For other events, try to get profile
      const profile = profileCache.get(event.pubkey);

      // If no profile, request it
      if (!profile) {
        profileReq.emit({ kinds: [0], authors: [event.pubkey], limit: 1 });
      }

      onEvent({ event, profile });
    },
    error: (err) => {
      console.error('Subscription error:', err);
    },
  });

  // Profile subscription
  const profileSubscription = client.use(profileReq).subscribe({
    next: (packet) => {
      const event = packet.event as NostrEvent;
      if (event.kind === 0) {
        try {
          const profile = JSON.parse(event.content) as Profile;
          profileCache.set(event.pubkey, profile);
        } catch {
          // Ignore invalid profile content
        }
      }
    },
  });

  // Store subscription handle
  activeSubscriptions.set(timelineNodeId, {
    subscription,
    rxReq,
    profileSubscription,
    profileReq,
  });

  // Emit the filter to start receiving events
  rxReq.emit(filter as { kinds?: number[]; limit?: number });

  // Handle EOSE
  if (onEose) {
    // rx-nostr handles EOSE internally, we can call onEose after a short delay
    setTimeout(onEose, 2000);
  }
}

export function unsubscribe(timelineNodeId: string): void {
  const handle = activeSubscriptions.get(timelineNodeId);
  if (handle) {
    handle.subscription.unsubscribe();
    if (handle.profileSubscription) {
      handle.profileSubscription.unsubscribe();
    }
    activeSubscriptions.delete(timelineNodeId);
  }
}

export function unsubscribeAll(): void {
  for (const [id] of activeSubscriptions) {
    unsubscribe(id);
  }
}

export function getCachedProfile(pubkey: string): Profile | undefined {
  return profileCache.get(pubkey);
}
