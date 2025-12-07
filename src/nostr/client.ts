import { createRxNostr, createRxForwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import type { Profile } from './types';

let rxNostr: RxNostr | null = null;

export function getRxNostr(): RxNostr {
  if (!rxNostr) {
    rxNostr = createRxNostr({
      verifier,
    });
  }
  return rxNostr;
}

export function createSubscription(relayUrls: string[], filter: Record<string, unknown>) {
  const client = getRxNostr();
  client.setDefaultRelays(relayUrls);

  const rxReq = createRxForwardReq();

  const subscription = client.use(rxReq);

  // Emit the filter
  rxReq.emit(filter as { kinds?: number[]; authors?: string[]; ids?: string[]; limit?: number });

  return { subscription, rxReq };
}

// Profile cache
const profileCache = new Map<string, Profile>();

export function getCachedProfile(pubkey: string): Profile | undefined {
  return profileCache.get(pubkey);
}

export function cacheProfile(pubkey: string, profile: Profile): void {
  profileCache.set(pubkey, profile);
}

export function parseProfileContent(content: string): Profile {
  try {
    return JSON.parse(content) as Profile;
  } catch {
    return {};
  }
}
