// Nostr Graph Storage - Save/Load graphs to/from Nostr relays
// Uses NIP-78 (kind:30078) for application-specific data

import { createRxBackwardReq } from 'rx-nostr';
import { getPubkey, signEvent, isNip07Available } from './nip07';
import type { UnsignedEvent } from './nip07';
import type { NostrEvent, Profile } from './types';
import { saveProfileToCache } from './profileCache';
import type { GraphData, GraphVisibility } from '../graph/types';
import { fetchUserRelayList, fetchRelayList, getRxNostr, getDefaultRelayUrl, INDEXER_RELAYS } from './nostr';
export { initUserRelayList, fetchUserRelayList, fetchRelayList, getDefaultRelayUrl, INDEXER_RELAYS } from './nostr';
export type { RelayMode } from './nostr';

// Kind constants
const KIND_APP_DATA = 30078;
const KIND_DELETE = 5;

// Graph path prefix
const GRAPH_PATH_PREFIX = 'mojimoji/graphs/';

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

// Cache for all mojimoji graphs (fetched once on app load)
// This contains all graphs from user's relays, filtered by #client: ['mojimoji']
let allGraphsCache: NostrGraphItem[] | null = null;
let allGraphsPromise: Promise<NostrGraphItem[]> | null = null;

// Initialize all graphs cache (call on app load, after relay list is initialized)
// Fetches all mojimoji graphs from user's relays with #client: ['mojimoji'] filter
export async function initAllGraphs(): Promise<NostrGraphItem[]> {
  try {
    const graphs = await fetchAllGraphsFromRelays();
    allGraphsCache = graphs;
    return graphs;
  } catch {
    return [];
  }
}

// Invalidate graphs cache (call after save/delete)
function invalidateGraphsCache(): void {
  allGraphsCache = null;
}

// Fetch all mojimoji graphs from user's relays (single subscription with #client filter)
async function fetchAllGraphsFromRelays(): Promise<NostrGraphItem[]> {
  let relays = await fetchUserRelayList();
  if (relays.length === 0) {
    relays = [getDefaultRelayUrl()];
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays);

    const rxReq = createRxBackwardReq();
    const eventsMap = new Map<string, NostrEvent>();
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        // Check if it's a mojimoji graph event by d-tag prefix
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
          resolve(parseGraphEvents(Array.from(eventsMap.values()), null));
        }
      },
      complete: () => {
        if (!resolved) {
          resolved = true;
          resolve(parseGraphEvents(Array.from(eventsMap.values()), null));
        }
      },
    });

    // Fetch all mojimoji graphs with #client filter
    rxReq.emit({
      kinds: [KIND_APP_DATA],
      '#client': ['mojimoji'],
      limit: 500,
    }, { relays });
    rxReq.over();

    // Fallback timeout after 5 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolve(parseGraphEvents(Array.from(eventsMap.values()), null));
      }
    }, 5000);
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

  // Get relay URLs (use write relays for publishing)
  let relayUrls = options.relayUrls?.filter(url => url.trim());
  if (!relayUrls || relayUrls.length === 0) {
    relayUrls = await fetchUserRelayList('write');
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

  // Invalidate user graphs cache since we saved a new graph
  invalidateGraphsCache();

  // Return the event ID
  return signedEvent.id;
}

// Load graphs from Nostr relay (filters from cache for 'mine' and 'public')
export async function loadGraphsFromNostr(
  filter: 'public' | 'mine' | 'by-author',
  authorPubkey?: string,
  relayUrls?: string[]
): Promise<NostrGraphItem[]> {
  // For 'mine' and 'public' filters, use the all-graphs cache and filter in app
  if (filter === 'mine' || filter === 'public') {
    // Ensure cache is loaded
    if (allGraphsCache === null) {
      if (allGraphsPromise !== null) {
        await allGraphsPromise;
      } else {
        allGraphsPromise = initAllGraphs();
        await allGraphsPromise;
        allGraphsPromise = null;
      }
    }

    const graphs = allGraphsCache || [];

    if (filter === 'mine') {
      if (!isNip07Available()) {
        throw new Error('NIP-07 extension not available');
      }
      const userPubkey = await getPubkey();
      // Filter by user's pubkey (author's own graphs)
      return graphs.filter(g => g.pubkey === userPubkey);
    } else {
      // Filter by public visibility
      return graphs.filter(g => g.visibility === 'public');
    }
  }

  // For 'by-author' filter, fetch from author's relays (not cached)
  return loadGraphsFromNostrInternal(filter, authorPubkey, relayUrls);
}

// Internal implementation of loadGraphsFromNostr
async function loadGraphsFromNostrInternal(
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
      relays = await fetchUserRelayList();
    }
  }

  // For 'by-author', use the provided pubkey
  if (filter === 'by-author') {
    if (!authorPubkey) {
      throw new Error('Author pubkey is required for by-author filter');
    }
    if (!relays || relays.length === 0) {
      relays = await fetchRelayList(authorPubkey);
    }
  }

  // For 'public', use user's relay list if not specified
  if (filter === 'public' && (!relays || relays.length === 0)) {
    relays = await fetchUserRelayList();
    if (relays.length === 0) {
      relays = [getDefaultRelayUrl()];
    }
  }

  // For 'mine' and 'by-author', require relays from user's relay list
  if (!relays || relays.length === 0) {
    throw new Error('No relay URLs available. Please configure your relay list (kind:10002).');
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
    relays = await fetchRelayList(pubkey);
  }
  if (relays.length === 0) {
    relays = [getDefaultRelayUrl()];
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

// Load a graph by event ID (for permalink loading)
export async function loadGraphByEventId(
  eventId: string
): Promise<GraphData | null> {
  // Use user's relay list (kind:30078 is not stored on bootstrap/indexer relays)
  let relays = await fetchUserRelayList();
  if (relays.length === 0) {
    relays = [getDefaultRelayUrl()];
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays);

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
    }, { relays });
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

// Load a graph by naddr parameters (kind + pubkey + d-tag)
// This always fetches the latest version of the addressable event
export async function loadGraphByNaddr(
  kind: number,
  pubkey: string,
  dTag: string,
  relayHints?: string[]
): Promise<GraphData | null> {
  // Use relay hints if provided, otherwise use user's relays or well-known
  let relays = relayHints?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    relays = await fetchRelayList(pubkey);
  }
  if (relays.length === 0) {
    relays = INDEXER_RELAYS;
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays!);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    let resolved = false;
    let latestEvent: NostrEvent | null = null;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        // Verify it matches our query
        const eventDTag = event.tags.find(t => t[0] === 'd');
        if (event.kind === kind &&
            event.pubkey === pubkey &&
            eventDTag && eventDTag[1] === dTag) {
          // Keep the newest event
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          resolveWithEvent();
        }
      },
      complete: () => {
        // EOSE received - resolve with the latest event
        if (!resolved) {
          resolved = true;
          resolveWithEvent();
        }
      },
    });

    function resolveWithEvent() {
      if (latestEvent) {
        try {
          const graphData = JSON.parse(latestEvent.content) as GraphData;
          resolve(graphData);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    }

    rxReq.emit({
      kinds: [kind],
      authors: [pubkey],
      '#d': [dTag],
      limit: 1,
    }, { relays: relays! });
    rxReq.over();

    // Timeout after 7 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription.unsubscribe();
        resolveWithEvent();
      }
    }, 7000);
  });
}

// Delete graph from Nostr relay (NIP-09)
export async function deleteGraphFromNostr(
  path: string,
  relayUrls?: string[],
  eventId?: string
): Promise<void> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available');
  }

  const pubkey = await getPubkey();

  // Use write relays for publishing deletion event
  let relays = relayUrls?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    relays = await fetchUserRelayList('write');
  }
  if (relays.length === 0) {
    throw new Error('No relay URLs available for deletion');
  }

  // Build deletion tags (NIP-09)
  const tags: string[][] = [
    ['a', `${KIND_APP_DATA}:${pubkey}:${GRAPH_PATH_PREFIX}${path}`],
    ['k', String(KIND_APP_DATA)],
  ];

  // Add event ID reference if provided (better relay compatibility)
  if (eventId) {
    tags.unshift(['e', eventId]);
  }

  // Create deletion event (NIP-09)
  const unsignedEvent: UnsignedEvent = {
    kind: KIND_DELETE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };

  const signedEvent = await signEvent(unsignedEvent);

  const client = getRxNostr();
  client.setDefaultRelays(relays);
  client.send(signedEvent);

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Invalidate user graphs cache since we deleted a graph
  invalidateGraphsCache();
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

// Fetch profiles from relays and save to cache
export async function fetchAndCacheProfiles(relayUrls?: string[]): Promise<number> {
  let relays = relayUrls?.filter(url => url.trim());
  if (!relays || relays.length === 0) {
    // Try to get user's relays from NIP-07
    if (isNip07Available()) {
      try {
        relays = await fetchUserRelayList();
      } catch {
        // ignore
      }
    }
  }
  if (!relays || relays.length === 0) {
    relays = [getDefaultRelayUrl()];
  }

  return new Promise((resolve) => {
    const client = getRxNostr();
    client.setDefaultRelays(relays!);

    // Use backward strategy for one-shot queries
    const rxReq = createRxBackwardReq();
    let profileCount = 0;
    let resolved = false;

    const subscription = client.use(rxReq).subscribe({
      next: (packet) => {
        const event = packet.event as NostrEvent;
        if (event.kind === 0) {
          try {
            const content = JSON.parse(event.content);
            const profile: Profile = {
              name: content.name || '',
              display_name: content.display_name || '',
              picture: content.picture || '',
              about: content.about || '',
              nip05: content.nip05 || '',
            };
            saveProfileToCache(event.pubkey, profile);
            profileCount++;
          } catch {
            // ignore parse errors
          }
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          resolve(profileCount);
        }
      },
      complete: () => {
        // EOSE received - resolve with profiles collected
        if (!resolved) {
          resolved = true;
          resolve(profileCount);
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
        resolve(profileCount);
      }
    }, 5000);
  });
}
