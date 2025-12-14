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

// Extract content warning from event tags (NIP-36)
// Returns: string (reason), null (warning with no reason), undefined (no warning)
export function extractContentWarning(event: NostrEvent): string | null | undefined {
  const cwTag = event.tags.find(tag => tag[0] === 'content-warning');
  if (!cwTag) return undefined;
  return cwTag[1] || null; // Return reason or null if no reason provided
}

// Extract image URLs from text content
// Supports: jpg, jpeg, gif, png (case insensitive)
const IMAGE_URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(jpg|jpeg|gif|png)(\?[^\s<>"{}|\\^`\[\]]*)?/gi;

export function extractImageUrls(content: string): string[] {
  const matches = content.match(IMAGE_URL_REGEX);
  return matches ? [...new Set(matches)] : []; // Remove duplicates
}

// Check if URL is a valid HTTPS image URL
export function isValidImageUrl(url: string): boolean {
  return url.startsWith('https://') && IMAGE_URL_REGEX.test(url);
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
