// Nostr event types
import { bech32 } from 'bech32';

// Convert hex pubkey to npub format (NIP-19)
export function pubkeyToNpub(pubkey: string): string {
  try {
    const bytes = [];
    for (let i = 0; i < pubkey.length; i += 2) {
      bytes.push(parseInt(pubkey.slice(i, i + 2), 16));
    }
    const words = bech32.toWords(new Uint8Array(bytes));
    return bech32.encode('npub', words, 90);
  } catch {
    return pubkey.slice(0, 8); // Fallback to hex prefix
  }
}

// Convert hex event id to nevent format (NIP-19)
// Uses TLV format: type 0 (special) = event id
export function eventIdToNevent(eventId: string): string {
  try {
    // Convert hex to bytes
    const eventIdBytes = [];
    for (let i = 0; i < eventId.length; i += 2) {
      eventIdBytes.push(parseInt(eventId.slice(i, i + 2), 16));
    }

    // Build TLV: type 0 (special) | length 32 | event id bytes
    const tlvData = [0, 32, ...eventIdBytes];

    const words = bech32.toWords(new Uint8Array(tlvData));
    return bech32.encode('nevent', words, 1000); // nevent can be long
  } catch {
    return eventId; // Fallback to hex
  }
}

// Decode bech32 NIP-19 identifier to hex
// Supports: npub, note, nprofile, nevent
export function decodeBech32ToHex(str: string): { type: string; hex: string } | null {
  try {
    const trimmed = str.trim().toLowerCase();

    // Check if it's a valid bech32 prefix
    if (!trimmed.match(/^(npub|note|nprofile|nevent)1/)) {
      return null;
    }

    const decoded = bech32.decode(trimmed, 90);
    const prefix = decoded.prefix;
    const data = bech32.fromWords(decoded.words);

    // For simple types (npub, note), the data is just the hex
    if (prefix === 'npub' || prefix === 'note') {
      const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
      return { type: prefix, hex };
    }

    // For TLV types (nprofile, nevent), extract the main identifier
    // TLV format: type (1 byte) | length (1 byte) | value (length bytes)
    if (prefix === 'nprofile' || prefix === 'nevent') {
      let i = 0;
      while (i < data.length) {
        const type = data[i];
        const length = data[i + 1];
        const value = data.slice(i + 2, i + 2 + length);

        // Type 0 is the main identifier (pubkey for nprofile, event id for nevent)
        if (type === 0) {
          const hex = Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
          return { type: prefix, hex };
        }

        i += 2 + length;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Check if string is a valid 64-character hex string
export function isHex64(str: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(str.trim());
}

// Normalize pubkey to hex format
// Accepts: hex (64 chars), npub1..., nprofile1...
// Returns: hex string (lowercase) or original if invalid
export function normalizePubkeyToHex(pubkey: string): string {
  const trimmed = pubkey.trim();

  // Already hex
  if (isHex64(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Try bech32 decode
  const decoded = decodeBech32ToHex(trimmed);
  if (decoded && (decoded.type === 'npub' || decoded.type === 'nprofile')) {
    return decoded.hex.toLowerCase();
  }

  // Return original if can't normalize
  return trimmed;
}

// Normalize event ID to hex format
// Accepts: hex (64 chars), note1..., nevent1...
// Returns: hex string (lowercase) or original if invalid
export function normalizeEventIdToHex(eventId: string): string {
  const trimmed = eventId.trim();

  // Already hex
  if (isHex64(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Try bech32 decode
  const decoded = decodeBech32ToHex(trimmed);
  if (decoded && (decoded.type === 'note' || decoded.type === 'nevent')) {
    return decoded.hex.toLowerCase();
  }

  // Return original if can't normalize
  return trimmed;
}

// NIP-19 naddr encoding (parameterized replaceable event address)
// TLV format:
// - Type 0 (special): 32 bytes - pubkey
// - Type 1 (relay): string - relay URL (optional, can be multiple)
// - Type 2 (identifier): string - d-tag
// - Type 3 (kind): 4 bytes big-endian integer
export function naddrEncode(kind: number, pubkey: string, dTag: string, relays?: string[]): string {
  try {
    const tlvData: number[] = [];

    // Type 0: pubkey (32 bytes)
    const pubkeyBytes: number[] = [];
    for (let i = 0; i < pubkey.length; i += 2) {
      pubkeyBytes.push(parseInt(pubkey.slice(i, i + 2), 16));
    }
    tlvData.push(0, 32, ...pubkeyBytes);

    // Type 2: d-tag (identifier)
    const dTagBytes = new TextEncoder().encode(dTag);
    tlvData.push(2, dTagBytes.length, ...dTagBytes);

    // Type 3: kind (4 bytes big-endian)
    tlvData.push(3, 4,
      (kind >> 24) & 0xff,
      (kind >> 16) & 0xff,
      (kind >> 8) & 0xff,
      kind & 0xff
    );

    // Type 1: relays (optional)
    if (relays) {
      for (const relay of relays) {
        const relayBytes = new TextEncoder().encode(relay);
        tlvData.push(1, relayBytes.length, ...relayBytes);
      }
    }

    const words = bech32.toWords(new Uint8Array(tlvData));
    return bech32.encode('naddr', words, 1500);
  } catch {
    return '';
  }
}

// NIP-19 naddr decoding
export interface NaddrData {
  kind: number;
  pubkey: string;
  dTag: string;
  relays: string[];
}

export function naddrDecode(naddr: string): NaddrData | null {
  try {
    const trimmed = naddr.trim().toLowerCase();
    if (!trimmed.startsWith('naddr1')) {
      return null;
    }

    const decoded = bech32.decode(trimmed, 1500);
    const data = bech32.fromWords(decoded.words);

    let pubkey = '';
    let dTag = '';
    let kind = 0;
    const relays: string[] = [];

    let i = 0;
    while (i < data.length) {
      const type = data[i];
      const length = data[i + 1];
      const value = data.slice(i + 2, i + 2 + length);

      switch (type) {
        case 0: // pubkey
          pubkey = Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
          break;
        case 1: // relay
          relays.push(new TextDecoder().decode(new Uint8Array(value)));
          break;
        case 2: // d-tag (identifier)
          dTag = new TextDecoder().decode(new Uint8Array(value));
          break;
        case 3: // kind (4 bytes big-endian)
          kind = (value[0] << 24) | (value[1] << 16) | (value[2] << 8) | value[3];
          break;
      }

      i += 2 + length;
    }

    if (!pubkey || kind === 0) {
      return null;
    }

    return { kind, pubkey, dTag, relays };
  } catch {
    return null;
  }
}

// Parse date string to Unix timestamp (seconds)
// Supports:
// - Date only: YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD (time defaults to 00:00:00)
// - Date with time: YYYY-MM-DD HH:MM:SS, YYYY-MM-DD HH:MM
// - Time only: HH:MM:SS, HH:MM (date defaults to today)
export function parseDateToTimestamp(str: string): number | null {
  const trimmed = str.trim();

  // Match date with optional time: YYYY-MM-DD[ HH:MM[:SS]]
  const dateTimeMatch = trimmed.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dateTimeMatch) {
    const year = parseInt(dateTimeMatch[1], 10);
    const month = parseInt(dateTimeMatch[2], 10) - 1; // JS months are 0-indexed
    const day = parseInt(dateTimeMatch[3], 10);
    const hour = dateTimeMatch[4] ? parseInt(dateTimeMatch[4], 10) : 0;
    const minute = dateTimeMatch[5] ? parseInt(dateTimeMatch[5], 10) : 0;
    const second = dateTimeMatch[6] ? parseInt(dateTimeMatch[6], 10) : 0;

    // Validate components
    if (month < 0 || month > 11 || day < 1 || day > 31 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return null;
    }

    const date = new Date(year, month, day, hour, minute, second);
    if (isNaN(date.getTime())) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }

  // Match time only: HH:MM[:SS] (use today's date)
  const timeOnlyMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnlyMatch) {
    const hour = parseInt(timeOnlyMatch[1], 10);
    const minute = parseInt(timeOnlyMatch[2], 10);
    const second = timeOnlyMatch[3] ? parseInt(timeOnlyMatch[3], 10) : 0;

    // Validate components
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return null;
    }

    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, second);
    if (isNaN(date.getTime())) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }

  return null;
}

// Format npub for display (shortened)
export function formatNpub(pubkey: string): string {
  const npub = pubkeyToNpub(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-4)}`;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Profile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

export interface TimelineEvent {
  event: NostrEvent;
  profile?: Profile;
  contentWarning?: string | null; // NIP-36: content warning reason (null = has warning but no reason)
}

// Timeline item types for different data types
export type TimelineItemType = 'event' | 'eventId' | 'pubkey' | 'datetime' | 'relay' | 'integer' | 'flag' | 'relayStatus' | 'complete' | 'reactionGroup';

export interface TimelineItemBase {
  id: string;
  type: TimelineItemType;
}

// Reaction author info for grouped reactions
export interface ReactionAuthor {
  pubkey: string;
  profile?: Profile;
  timestamp: number;
}

// Grouped reactions by content (emoji)
export interface ReactionsByContent {
  content: string;  // The reaction emoji/text (e.g., "+", "🔥", "👍")
  authors: ReactionAuthor[];
}

export interface TimelineEventItem extends TimelineItemBase {
  type: 'event';
  event: NostrEvent;
  profile?: Profile;
  contentWarning?: string | null;
}

export interface TimelineEventIdItem extends TimelineItemBase {
  type: 'eventId';
  eventId: string;
}

export interface TimelinePubkeyItem extends TimelineItemBase {
  type: 'pubkey';
  pubkey: string;
  profile?: Profile;
}

export interface TimelineDatetimeItem extends TimelineItemBase {
  type: 'datetime';
  datetime: number; // Unix timestamp
}

export interface TimelineRelayItem extends TimelineItemBase {
  type: 'relay';
  relays: string[];
}

export interface TimelineIntegerItem extends TimelineItemBase {
  type: 'integer';
  value: number;
}

export interface TimelineFlagItem extends TimelineItemBase {
  type: 'flag';
  flag: boolean;
}

export interface TimelineRelayStatusItem extends TimelineItemBase {
  type: 'relayStatus';
  status: string;
}

export interface TimelineCompleteItem extends TimelineItemBase {
  type: 'complete';
}

// Grouped reactions to a single target event (bump-up system)
export interface TimelineReactionGroupItem extends TimelineItemBase {
  type: 'reactionGroup';
  targetEventId: string;
  targetEvent?: NostrEvent;
  targetProfile?: Profile;
  reactions: ReactionsByContent[];
  newestTimestamp: number;  // For sorting/bumping
}

export type TimelineItem =
  | TimelineEventItem
  | TimelineEventIdItem
  | TimelinePubkeyItem
  | TimelineDatetimeItem
  | TimelineRelayItem
  | TimelineIntegerItem
  | TimelineFlagItem
  | TimelineRelayStatusItem
  | TimelineCompleteItem
  | TimelineReactionGroupItem;

// Extract content warning from event tags (NIP-36)
// Returns: string (reason), null (warning with no reason), undefined (no warning)
export function extractContentWarning(event: NostrEvent): string | null | undefined {
  const cwTag = event.tags.find(tag => tag[0] === 'content-warning');
  if (!cwTag) return undefined;
  return cwTag[1] || null; // Return reason or null if no reason provided
}

// Reference type for quote/reply/repost/reaction events
export type EventReferenceType = 'quote' | 'reply' | 'repost' | 'reaction';

// Marker type for e tags (NIP-10)
export type ETagMarker = 'root' | 'reply' | 'mention';

// Event reference with marker
export interface EventReference {
  type: EventReferenceType;
  eventId: string;
  marker?: ETagMarker;
}

// Detect if an event references another event and return the reference type
// Returns null if no reference found
// Reference rules:
// - Quote: kind:1 with #q tag
// - Reply: kind:1 with #e tag (but no #q tag)
// - Repost: kind:6 with #e tag
// - Reaction: kind:7 with #e tag
export function detectEventReference(event: NostrEvent): { type: EventReferenceType; eventId: string } | null {
  const hasQTag = event.tags.find(tag => tag[0] === 'q');
  const hasETag = event.tags.find(tag => tag[0] === 'e');

  if (event.kind === 1) {
    // Quote: has #q tag
    if (hasQTag) {
      return { type: 'quote', eventId: hasQTag[1] };
    }
    // Reply: has #e tag (but not quote) - use new function to get proper reply target
    if (hasETag) {
      const refs = detectEventReferences(event);
      // Return the first reference (most relevant: reply > root > mention)
      if (refs.length > 0) {
        return { type: refs[0].type, eventId: refs[0].eventId };
      }
      return { type: 'reply', eventId: hasETag[1] };
    }
  } else if (event.kind === 6) {
    // Repost: kind 6 with #e tag
    if (hasETag) {
      return { type: 'repost', eventId: hasETag[1] };
    }
  } else if (event.kind === 7) {
    // Reaction: kind 7 with #e tag
    if (hasETag) {
      return { type: 'reaction', eventId: hasETag[1] };
    }
  }

  return null;
}

// Detect all event references with NIP-10 markers
// Returns references in order: root → reply → mention
// For deprecated positional scheme (no markers), returns up to 3 e tags
export function detectEventReferences(event: NostrEvent): EventReference[] {
  const hasQTag = event.tags.find(tag => tag[0] === 'q');

  // Quote: return q tag only
  if (event.kind === 1 && hasQTag) {
    return [{ type: 'quote', eventId: hasQTag[1] }];
  }

  // Get all e tags
  const eTags = event.tags.filter(tag => tag[0] === 'e' && tag[1]);
  if (eTags.length === 0) return [];

  // Check if any e tag has a marker (NIP-10 style)
  const hasMarkers = eTags.some(tag => tag[3] === 'root' || tag[3] === 'reply' || tag[3] === 'mention');

  if (hasMarkers) {
    // NIP-10 style with markers: order by root → reply → mention
    const result: EventReference[] = [];
    const markerOrder: ETagMarker[] = ['root', 'reply', 'mention'];

    for (const marker of markerOrder) {
      const tag = eTags.find(t => t[3] === marker);
      if (tag) {
        result.push({
          type: event.kind === 6 ? 'repost' : event.kind === 7 ? 'reaction' : 'reply',
          eventId: tag[1],
          marker,
        });
      }
    }
    return result;
  } else {
    // Deprecated positional scheme: return up to 3 e tags
    const result: EventReference[] = [];
    const maxTags = Math.min(eTags.length, 3);

    for (let i = 0; i < maxTags; i++) {
      result.push({
        type: event.kind === 6 ? 'repost' : event.kind === 7 ? 'reaction' : 'reply',
        eventId: eTags[i][1],
      });
    }
    return result;
  }
}

// Extract image URLs from text content
// Supports: jpg, jpeg, gif, png (case insensitive)
const IMAGE_URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(jpg|jpeg|gif|png)(\?[^\s<>"{}|\\^`\[\]]*)?/gi;

export function extractImageUrls(content: string): string[] {
  const matches = content.match(IMAGE_URL_REGEX);
  return matches ? [...new Set(matches)] : []; // Remove duplicates
}

// Signal type for event flow through the graph
// 'add' = event should be added/shown
// 'remove' = event should be removed/hidden (used by A-B operator)
export type SignalType = 'add' | 'remove';

export interface EventSignal {
  event: NostrEvent;
  signal: SignalType;
}

export interface FilterItem {
  name: 'ids' | 'authors' | 'kinds' | 'since' | 'until' | 'limit' | string;
  value: string;
}

export interface RelayNodeData {
  relayUrls: string[];
  filters: FilterItem[];
}

export interface OperatorNodeData {
  operator: 'AND' | 'OR' | 'A-B';
}

export interface SearchNodeData {
  keyword: string;
  useRegex: boolean;
}

export interface TimelineNodeData {
  timelineName: string;
}
