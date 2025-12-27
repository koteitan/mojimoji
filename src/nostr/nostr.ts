// Nostr relay list utilities
// Fetch and cache user's relay list (NIP-65, kind:10002)

import { createRxNostr, createRxBackwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { getPubkey, isNip07Available } from './nip07';
import type { NostrEvent } from './types';
import i18next from 'i18next';

// Kind constant for relay list (NIP-65)
const KIND_RELAY_LIST = 10002;

// Get default relay URL based on locale
// Japanese users -> yabu.me, others -> relay.damus.io
export function getDefaultRelayUrl(): string {
  const lang = i18next.language || (typeof navigator !== 'undefined' ? navigator.language : 'en');
  if (lang.startsWith('ja')) {
    return 'wss://yabu.me';
  }
  return 'wss://relay.damus.io';
}

// Indexer relays for fetching kind:10002 (not for kind:30078)
export const INDEXER_RELAYS = [
  'wss://directory.yabu.me',
  'wss://purplepag.es',
  'wss://indexer.coracle.social'
];

// Singleton rx-nostr instance for relay list queries
let rxNostr: RxNostr | null = null;

export function getRxNostr(): RxNostr {
  if (!rxNostr) {
    rxNostr = createRxNostr({
      verifier,
      eoseTimeout: 3000,
      skipFetchNip11: true,
      skipExpirationCheck: true,
    });
  }
  return rxNostr;
}

// Relay mode for NIP-65 read/write distinction
export type RelayMode = 'read' | 'write';

// Cache for user's relay list (fetched once on app load)
// Separate caches for read and write relays per NIP-65
let userReadRelayCache: string[] | null = null;
let userWriteRelayCache: string[] | null = null;
let userRelayListPromise: Promise<void> | null = null;

// Initialize user's relay list cache (call on app load)
// Fetches both read and write relays
export async function initUserRelayList(): Promise<void> {
  if (!isNip07Available()) {
    return;
  }
  try {
    const pubkey = await getPubkey();
    // Fetch read and write relays in parallel
    const [readRelays, writeRelays] = await Promise.all([
      fetchRelayList(pubkey, 'read'),
      fetchRelayList(pubkey, 'write'),
    ]);
    userReadRelayCache = readRelays;
    userWriteRelayCache = writeRelays;
  } catch {
    // ignore
  }
}

// Fetch relay list of the logged-in user via browser extension (uses cache)
export async function fetchUserRelayList(mode: 'read' | 'write' = 'read'): Promise<string[]> {
  const cache = mode === 'read' ? userReadRelayCache : userWriteRelayCache;
  // Return cache if available and not empty
  if (cache !== null && cache.length > 0) {
    return cache;
  }
  // If already fetching, wait for that promise
  if (userRelayListPromise !== null) {
    await userRelayListPromise;
    return (mode === 'read' ? userReadRelayCache : userWriteRelayCache) || [];
  }
  // Fetch and cache
  userRelayListPromise = initUserRelayList();
  await userRelayListPromise;
  userRelayListPromise = null;
  return (mode === 'read' ? userReadRelayCache : userWriteRelayCache) || [];
}

// Fetch relay list of any user by pubkey with read/write mode
export async function fetchRelayList(pubkey: string, mode: RelayMode = 'read'): Promise<string[]> {
  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(INDEXER_RELAYS);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    const relays: string[] = [];
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind === KIND_RELAY_LIST) {
          // Extract relay URLs from 'r' tags with read/write filtering
          for (const tag of event.tags) {
            if (tag[0] === 'r' && tag[1]) {
              const marker = tag[2]; // 'read', 'write', or undefined (both)
              // Include if: no marker (both), or marker matches mode
              if (!marker || marker === mode) {
                relays.push(tag[1]);
              }
            }
          }
          // Resolve immediately when we get the relay list
          if (!resolved) {
            resolved = true;
            subscription.unsubscribe();
            resolve(relays);
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          resolve([]);
        }
      },
      complete: () => {
        // EOSE received - resolve with whatever relays we found
        if (!resolved) {
          resolved = true;
          resolve(relays);
        }
      },
    });

    // Emit filter for relay list
    rxReq.emit({
      kinds: [KIND_RELAY_LIST],
      authors: [pubkey],
      limit: 1,
    }, { relays: INDEXER_RELAYS });
    rxReq.over();

    // Fallback timeout after 3 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(relays);
      }
    }, 3000);
  });
}
