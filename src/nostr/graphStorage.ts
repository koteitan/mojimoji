// Nostr Graph Storage - Save/Load graphs to/from Nostr relays
// Uses NIP-78 (kind:30078) for application-specific data

import { createRxNostr, createRxBackwardReq } from 'rx-nostr';
import type { RxNostr } from 'rx-nostr';
import { verifier } from '@rx-nostr/crypto';
import { getPubkey, signEvent, isNip07Available } from './nip07';
import type { UnsignedEvent } from './nip07';
import type { NostrEvent, Profile } from './types';
import type { GraphData, GraphVisibility } from '../graph/types';

// Kind constants
const KIND_RELAY_LIST = 10002;
const KIND_APP_DATA = 30078;
const KIND_DELETE = 5;

// Graph path prefix
const GRAPH_PATH_PREFIX = 'mojimoji/graphs/';

// Well-known relays for fetching user metadata
const WELL_KNOWN_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

// Singleton rx-nostr instance for graph storage
let rxNostr: RxNostr | null = null;

function getRxNostr(): RxNostr {
  if (!rxNostr) {
    rxNostr = createRxNostr({
      verifier,
      // Performance optimizations
      eoseTimeout: 3000,        // Wait max 3 seconds for EOSE (default is longer)
      skipFetchNip11: true,     // Skip fetching relay information
      skipExpirationCheck: true, // Skip NIP-40 expiration check for faster processing
    });
  }
  return rxNostr;
}

// Nostr graph item for display in dialogs
export interface NostrGraphItem {
  path: string;
  name: string;
  createdAt: number;
  pubkey: string;
  isDirectory: boolean;
  visibility?: GraphVisibility;
  event?: NostrEvent;
}

// Fetch user's relay list from kind:10002
export async function fetchUserRelays(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(WELL_KNOWN_RELAYS);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    const relays: string[] = [];
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind === KIND_RELAY_LIST) {
          // Extract relay URLs from 'r' tags
          for (const tag of event.tags) {
            if (tag[0] === 'r' && tag[1]) {
              // tag[2] might be 'read' or 'write', but we want all for now
              relays.push(tag[1]);
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
    }, { relays: WELL_KNOWN_RELAYS });
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

// Save graph to Nostr relay
// Returns the event ID of the saved event
export async function saveGraphToNostr(
  path: string,
  graphData: GraphData,
  options: {
    visibility: 'public' | 'private';
    relayUrls?: string[];
  }
): Promise<string> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available. Please install a Nostr signer extension like nos2x or Alby.');
  }

  // Get user's pubkey
  const pubkey = await getPubkey();

  // Get relay URLs
  let relayUrls = options.relayUrls?.filter(url => url.trim());
  if (!relayUrls || relayUrls.length === 0) {
    relayUrls = await fetchUserRelays(pubkey);
    if (relayUrls.length === 0) {
      throw new Error('No relay URLs specified and no relay list found. Please specify relay URLs.');
    }
  }

  // Build tags (visibility is stored in graph data, not as a tag in version 2)
  const tags: string[][] = [
    ['d', GRAPH_PATH_PREFIX + path],
    ['client', 'mojimoji'],
  ];

  // Add visibility to graph data (API version 2)
  const graphDataWithVisibility: GraphData = {
    ...graphData,
    visibility: options.visibility,
  };

  // Create unsigned event
  const unsignedEvent: UnsignedEvent = {
    kind: KIND_APP_DATA,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(graphDataWithVisibility),
  };

  // Sign event
  const signedEvent = await signEvent(unsignedEvent);

  // Publish to relays
  const client = getRxNostr();
  client.setDefaultRelays(relayUrls);
  client.send(signedEvent);

  // Wait a bit for the event to be sent
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Return the event ID
  return signedEvent.id;
}

// Load graphs from Nostr relay
export async function loadGraphsFromNostr(
  filter: 'public' | 'mine' | 'by-author',
  authorPubkey?: string,
  relayUrls?: string[]
): Promise<NostrGraphItem[]> {
  // Build relay list
  let relays = relayUrls?.filter(url => url.trim());

  // For 'mine' filter, we need the user's pubkey and relays
  let userPubkey: string | null = null;
  if (filter === 'mine') {
    if (!isNip07Available()) {
      throw new Error('NIP-07 extension not available');
    }
    userPubkey = await getPubkey();
    if (!relays || relays.length === 0) {
      relays = await fetchUserRelays(userPubkey);
    }
  }

  // For 'by-author', use the provided pubkey
  if (filter === 'by-author') {
    if (!authorPubkey) {
      throw new Error('Author pubkey is required for by-author filter');
    }
    if (!relays || relays.length === 0) {
      relays = await fetchUserRelays(authorPubkey);
    }
  }

  // For 'public', use well-known relays if not specified
  if (filter === 'public' && (!relays || relays.length === 0)) {
    relays = WELL_KNOWN_RELAYS;
  }

  if (!relays || relays.length === 0) {
    relays = WELL_KNOWN_RELAYS;
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays!);

    // Use backward strategy - completes on EOSE instead of waiting for timeout
    const rxReq = createRxBackwardReq();
    // Use Map to deduplicate events by d-tag (addressable event identifier)
    const eventsMap = new Map<string, NostrEvent>();
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        // Check if it's a mojimoji graph event
        const dTag = event.tags.find(t => t[0] === 'd' && t[1]?.startsWith(GRAPH_PATH_PREFIX));
        if (dTag) {
          // Deduplicate by kind:pubkey:d-tag, keeping the newest event
          const key = `${event.kind}:${event.pubkey}:${dTag[1]}`;
          const existing = eventsMap.get(key);
          if (!existing || event.created_at > existing.created_at) {
            eventsMap.set(key, event);
          }
        }
      },
      error: (err) => {
        console.error('Error loading graphs:', err);
        if (!resolved) {
          resolved = true;
          resolve(parseGraphEvents(Array.from(eventsMap.values()), userPubkey));
        }
      },
      complete: () => {
        // EOSE received from all relays - resolve immediately
        if (!resolved) {
          resolved = true;
          resolve(parseGraphEvents(Array.from(eventsMap.values()), userPubkey));
        }
      },
    });

    // Build filter based on type
    const nostrFilter: Record<string, unknown> = {
      kinds: [KIND_APP_DATA],
      limit: 100,
    };

    if (filter === 'mine' && userPubkey) {
      nostrFilter.authors = [userPubkey];
    } else if (filter === 'by-author' && authorPubkey) {
      nostrFilter.authors = [authorPubkey];
    } else if (filter === 'public') {
      nostrFilter['#public'] = [''];
    }

    // Emit with relay specification for backward strategy
    rxReq.emit(nostrFilter as { kinds: number[]; limit: number }, { relays: relays! });
    // Signal that no more REQs will be emitted
    rxReq.over();

    // Fallback timeout after 5 seconds (in case EOSE never arrives)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(parseGraphEvents(Array.from(eventsMap.values()), userPubkey));
      }
    }, 5000);
  });
}

// Load a single graph by path
export async function loadGraphByPath(
  path: string,
  pubkey: string,
  relayUrls?: string[]
): Promise<GraphData | null> {
  let relays = relayUrls?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    relays = await fetchUserRelays(pubkey);
  }
  if (relays.length === 0) {
    relays = WELL_KNOWN_RELAYS;
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays!);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        const dTag = event.tags.find(t => t[0] === 'd');
        if (dTag && dTag[1] === GRAPH_PATH_PREFIX + path) {
          if (!resolved) {
            resolved = true;
            subscription.unsubscribe();
            try {
              const graphData = JSON.parse(event.content) as GraphData;
              resolve(graphData);
            } catch {
              resolve(null);
            }
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      },
      complete: () => {
        // EOSE received without finding the graph
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      },
    });

    rxReq.emit({
      kinds: [KIND_APP_DATA],
      authors: [pubkey],
      '#d': [GRAPH_PATH_PREFIX + path],
      limit: 1,
    }, { relays: relays! });
    rxReq.over();

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(null);
      }
    }, 5000);
  });
}

// Well-known relays for permalink loading (need broader coverage)
const PERMALINK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://yabu.me',
];

// Load a graph by event ID (for permalink loading)
export async function loadGraphByEventId(
  eventId: string
): Promise<GraphData | null> {
  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(PERMALINK_RELAYS);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.id === eventId && event.kind === KIND_APP_DATA) {
          if (!resolved) {
            resolved = true;
            subscription.unsubscribe();
            try {
              const graphData = JSON.parse(event.content) as GraphData;
              resolve(graphData);
            } catch {
              resolve(null);
            }
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      },
      complete: () => {
        // EOSE received without finding the graph
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      },
    });

    rxReq.emit({
      kinds: [KIND_APP_DATA],
      ids: [eventId],
      limit: 1,
    }, { relays: PERMALINK_RELAYS });
    rxReq.over();

    // Timeout after 7 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(null);
      }
    }, 7000);
  });
}

// Delete graph from Nostr relay (NIP-09)
export async function deleteGraphFromNostr(
  path: string,
  relayUrls?: string[]
): Promise<void> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available');
  }

  const pubkey = await getPubkey();

  let relays = relayUrls?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    relays = await fetchUserRelays(pubkey);
  }
  if (relays.length === 0) {
    throw new Error('No relay URLs available for deletion');
  }

  // Create deletion event (NIP-09)
  const unsignedEvent: UnsignedEvent = {
    kind: KIND_DELETE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['a', `${KIND_APP_DATA}:${pubkey}:${GRAPH_PATH_PREFIX}${path}`],
      ['k', String(KIND_APP_DATA)],
    ],
    content: '',
  };

  const signedEvent = await signEvent(unsignedEvent);

  const client = getRxNostr();
  client.setDefaultRelays(relays);
  client.send(signedEvent);

  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Extract visibility from event (check graph data first, then fall back to tag)
function extractVisibility(event: NostrEvent): GraphVisibility {
  // First, try to get visibility from graph data (API version 2+)
  try {
    const graphData = JSON.parse(event.content) as GraphData;
    if (graphData.visibility) {
      return graphData.visibility;
    }
  } catch {
    // Failed to parse content, fall back to tag
  }

  // Fall back to checking Nostr tag (API version 1 compatibility)
  const hasPublicTag = event.tags.some(t => t[0] === 'public');
  return hasPublicTag ? 'public' : 'private';
}

// Parse graph events into directory structure
function parseGraphEvents(events: NostrEvent[], _userPubkey: string | null): NostrGraphItem[] {
  const items: NostrGraphItem[] = [];
  const directories = new Set<string>();

  for (const event of events) {
    const dTag = event.tags.find(t => t[0] === 'd');
    if (!dTag || !dTag[1]?.startsWith(GRAPH_PATH_PREFIX)) continue;

    const fullPath = dTag[1].slice(GRAPH_PATH_PREFIX.length);
    const parts = fullPath.split('/');
    const name = parts[parts.length - 1];

    // Add parent directories
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      directories.add(dirPath);
    }

    // Extract visibility from graph data or tag
    const visibility = extractVisibility(event);

    items.push({
      path: fullPath,
      name,
      createdAt: event.created_at,
      pubkey: event.pubkey,
      isDirectory: false,
      visibility,
      event,
    });
  }

  // Add directory items
  for (const dirPath of directories) {
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    items.push({
      path: dirPath,
      name,
      createdAt: 0,
      pubkey: '',
      isDirectory: true,
    });
  }

  return items;
}

// Get items in a specific directory
export function getNostrItemsInDirectory(
  allItems: NostrGraphItem[],
  directory: string,
  _userPubkey: string | null
): NostrGraphItem[] {
  const result: NostrGraphItem[] = [];
  const seenDirs = new Set<string>();

  for (const item of allItems) {
    const parentDir = item.path.includes('/')
      ? item.path.slice(0, item.path.lastIndexOf('/'))
      : '';

    // Check if this item is in the target directory
    if (parentDir === directory) {
      if (item.isDirectory) {
        if (!seenDirs.has(item.name)) {
          seenDirs.add(item.name);
          result.push(item);
        }
      } else {
        result.push(item);
      }
    } else if (item.path.startsWith(directory ? directory + '/' : '')) {
      // Check for subdirectories
      const relativePath = directory ? item.path.slice(directory.length + 1) : item.path;
      const firstSlash = relativePath.indexOf('/');
      if (firstSlash > 0) {
        const subDir = relativePath.slice(0, firstSlash);
        if (!seenDirs.has(subDir)) {
          seenDirs.add(subDir);
          result.push({
            path: directory ? `${directory}/${subDir}` : subDir,
            name: subDir,
            createdAt: 0,
            pubkey: '',
            isDirectory: true,
          });
        }
      }
    }
  }

  // Sort: directories first, then by name
  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}

// Profile utilities for author display
export function getProfileFromCache(pubkey: string): Profile | undefined {
  const cacheStr = localStorage.getItem('mojimoji-profile-cache');
  if (!cacheStr) return undefined;
  try {
    const cache = JSON.parse(cacheStr) as Record<string, Profile>;
    return cache[pubkey];
  } catch {
    return undefined;
  }
}

// Get all cached profiles for autocomplete
export function getAllCachedProfiles(): Array<{ pubkey: string; profile: Profile }> {
  const cacheStr = localStorage.getItem('mojimoji-profile-cache');
  if (!cacheStr) return [];
  try {
    const cache = JSON.parse(cacheStr) as Record<string, Profile>;
    return Object.entries(cache).map(([pubkey, profile]) => ({ pubkey, profile }));
  } catch {
    return [];
  }
}

// Update profile cache with new profiles
function updateProfileCache(profiles: Record<string, Profile>): void {
  const cacheStr = localStorage.getItem('mojimoji-profile-cache');
  let cache: Record<string, Profile> = {};
  if (cacheStr) {
    try {
      cache = JSON.parse(cacheStr) as Record<string, Profile>;
    } catch {
      // ignore
    }
  }
  // Merge new profiles into cache
  Object.assign(cache, profiles);
  localStorage.setItem('mojimoji-profile-cache', JSON.stringify(cache));
}

// Fetch profiles from relays and update cache
export async function fetchAndCacheProfiles(relayUrls?: string[]): Promise<number> {
  let relays = relayUrls?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    // Try to get user's relays from NIP-07
    if (isNip07Available()) {
      try {
        const pubkey = await getPubkey();
        relays = await fetchUserRelays(pubkey);
      } catch {
        // ignore
      }
    }
  }
  if (!relays || relays.length === 0) {
    relays = WELL_KNOWN_RELAYS;
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays!);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    const profiles: Record<string, Profile> = {};
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind === 0) {
          try {
            const content = JSON.parse(event.content);
            profiles[event.pubkey] = {
              name: content.name || '',
              display_name: content.display_name || '',
              picture: content.picture || '',
              about: content.about || '',
              nip05: content.nip05 || '',
            };
          } catch {
            // ignore parse errors
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          updateProfileCache(profiles);
          resolve(Object.keys(profiles).length);
        }
      },
      complete: () => {
        // EOSE received - resolve with profiles collected
        if (!resolved) {
          resolved = true;
          updateProfileCache(profiles);
          resolve(Object.keys(profiles).length);
        }
      },
    });

    // Emit filter for recent profiles
    rxReq.emit({
      kinds: [0],
      limit: 500,
    }, { relays: relays! });
    rxReq.over();

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        updateProfileCache(profiles);
        resolve(Object.keys(profiles).length);
      }
    }, 5000);
  });
}
