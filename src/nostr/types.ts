// Nostr event types

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

export interface SourceNodeData {
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

export interface DisplayNodeData {
  timelineName: string;
}
