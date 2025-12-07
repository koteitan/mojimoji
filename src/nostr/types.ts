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
