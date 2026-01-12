// Event actions: reaction and repost
import { createRxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { isNip07Available, signEvent } from './nip07';
import type { UnsignedEvent } from './nip07';
import { fetchUserRelayList } from './graphStorage';

const REACTED_STORAGE_KEY = 'mojimoji_reacted_events';
const REPOSTED_STORAGE_KEY = 'mojimoji_reposted_events';
const MAX_STORED_EVENTS = 500;

// Get reacted event IDs from LocalStorage as array (preserves order)
function getReactedEventIds(): string[] {
  try {
    const data = localStorage.getItem(REACTED_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Get reposted event IDs from LocalStorage as array (preserves order)
function getRepostedEventIds(): string[] {
  try {
    const data = localStorage.getItem(REPOSTED_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// Save reacted event ID to LocalStorage (max 500 events, removes oldest)
function saveReactedEventId(eventId: string): void {
  const ids = getReactedEventIds();
  if (!ids.includes(eventId)) {
    ids.push(eventId);
    // Remove oldest events if over limit
    while (ids.length > MAX_STORED_EVENTS) {
      ids.shift();
    }
  }
  localStorage.setItem(REACTED_STORAGE_KEY, JSON.stringify(ids));
}

// Save reposted event ID to LocalStorage (max 500 events, removes oldest)
function saveRepostedEventId(eventId: string): void {
  const ids = getRepostedEventIds();
  if (!ids.includes(eventId)) {
    ids.push(eventId);
    // Remove oldest events if over limit
    while (ids.length > MAX_STORED_EVENTS) {
      ids.shift();
    }
  }
  localStorage.setItem(REPOSTED_STORAGE_KEY, JSON.stringify(ids));
}

// Check if event is reacted
export function isEventReacted(eventId: string): boolean {
  return getReactedEventIds().includes(eventId);
}

// Check if event is reposted
export function isEventReposted(eventId: string): boolean {
  return getRepostedEventIds().includes(eventId);
}

// Send reaction (kind:7)
export async function sendReaction(eventId: string, eventPubkey: string): Promise<boolean> {
  if (!isNip07Available()) {
    console.error('NIP-07 extension not available');
    return false;
  }

  try {
    // Get write relays
    const relayUrls = await fetchUserRelayList('write');
    if (relayUrls.length === 0) {
      console.error('No write relays found');
      return false;
    }

    // Create unsigned kind:7 event
    const unsignedEvent: UnsignedEvent = {
      kind: 7,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', eventId],
        ['p', eventPubkey],
      ],
      content: '+',
    };

    // Sign the event
    const signedEvent = await signEvent(unsignedEvent);

    // Publish to relays
    const rxNostr = createRxNostr({ verifier });
    rxNostr.setDefaultRelays(relayUrls);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10000);
      let acknowledged = false;

      rxNostr.send(signedEvent).subscribe({
        next: (packet) => {
          if (packet.ok) {
            acknowledged = true;
            clearTimeout(timeout);
            saveReactedEventId(eventId);
            resolve(true);
          }
        },
        error: () => {},
        complete: () => {
          clearTimeout(timeout);
          if (acknowledged) {
            saveReactedEventId(eventId);
          }
          resolve(acknowledged);
        },
      });
    });
  } catch (e) {
    console.error('Failed to send reaction:', e);
    return false;
  }
}

// Send repost (kind:6)
export async function sendRepost(eventId: string, eventPubkey: string): Promise<boolean> {
  if (!isNip07Available()) {
    console.error('NIP-07 extension not available');
    return false;
  }

  try {
    // Get write relays
    const relayUrls = await fetchUserRelayList('write');
    if (relayUrls.length === 0) {
      console.error('No write relays found');
      return false;
    }

    // Create unsigned kind:6 event
    const unsignedEvent: UnsignedEvent = {
      kind: 6,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', eventId],
        ['p', eventPubkey],
      ],
      content: '',
    };

    // Sign the event
    const signedEvent = await signEvent(unsignedEvent);

    // Publish to relays
    const rxNostr = createRxNostr({ verifier });
    rxNostr.setDefaultRelays(relayUrls);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10000);
      let acknowledged = false;

      rxNostr.send(signedEvent).subscribe({
        next: (packet) => {
          if (packet.ok) {
            acknowledged = true;
            clearTimeout(timeout);
            saveRepostedEventId(eventId);
            resolve(true);
          }
        },
        error: () => {},
        complete: () => {
          clearTimeout(timeout);
          if (acknowledged) {
            saveRepostedEventId(eventId);
          }
          resolve(acknowledged);
        },
      });
    });
  } catch (e) {
    console.error('Failed to send repost:', e);
    return false;
  }
}
