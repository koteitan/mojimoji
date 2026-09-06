// Event actions: reaction and repost
import { createRxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { isNip07Available, signEvent } from './nip07';
import type { UnsignedEvent } from './nip07';
import { fetchUserRelayList } from './graphStorage';
import { lsLoadRaw, lsSaveRaw } from '../utils/localStorage';

// Reacted / reposted event IDs live in a single namespaced key
// 'mojimoji:actions' = { reacted: string[], reposted: string[] }
// Legacy keys are read as a fallback only; they are never written or removed.
const ACTIONS_NAME = 'actions';
const LEGACY_REACTED_STORAGE_KEY = 'mojimoji_reacted_events';
const LEGACY_REPOSTED_STORAGE_KEY = 'mojimoji_reposted_events';
const MAX_STORED_EVENTS = 500;

interface StoredActions {
  reacted: string[];
  reposted: string[];
}

// Read one legacy array key (pre-namespace format)
function loadLegacyIds(legacyKey: string): string[] {
  try {
    const data = localStorage.getItem(legacyKey);
    const parsed = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Load actions from LocalStorage, falling back to the legacy keys
function loadActions(): StoredActions {
  try {
    const data = lsLoadRaw(ACTIONS_NAME);
    if (data) {
      const parsed = JSON.parse(data) as Partial<StoredActions>;
      return {
        reacted: Array.isArray(parsed?.reacted) ? parsed.reacted : [],
        reposted: Array.isArray(parsed?.reposted) ? parsed.reposted : [],
      };
    }
  } catch {
    // Fall through to the legacy keys
  }
  return {
    reacted: loadLegacyIds(LEGACY_REACTED_STORAGE_KEY),
    reposted: loadLegacyIds(LEGACY_REPOSTED_STORAGE_KEY),
  };
}

// Save actions to LocalStorage (always to the namespaced key)
function saveActions(actions: StoredActions): void {
  lsSaveRaw(ACTIONS_NAME, JSON.stringify(actions));
}

// Get reacted event IDs from LocalStorage as array (preserves order)
function getReactedEventIds(): string[] {
  return loadActions().reacted;
}

// Get reposted event IDs from LocalStorage as array (preserves order)
function getRepostedEventIds(): string[] {
  return loadActions().reposted;
}

// Save reacted event ID to LocalStorage (max 500 events, removes oldest)
function saveReactedEventId(eventId: string): void {
  const actions = loadActions();
  const ids = actions.reacted;
  if (!ids.includes(eventId)) {
    ids.push(eventId);
    // Remove oldest events if over limit
    while (ids.length > MAX_STORED_EVENTS) {
      ids.shift();
    }
  }
  saveActions(actions);
}

// Save reposted event ID to LocalStorage (max 500 events, removes oldest)
function saveRepostedEventId(eventId: string): void {
  const actions = loadActions();
  const ids = actions.reposted;
  if (!ids.includes(eventId)) {
    ids.push(eventId);
    // Remove oldest events if over limit
    while (ids.length > MAX_STORED_EVENTS) {
      ids.shift();
    }
  }
  saveActions(actions);
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
