// NIP-07 Browser Extension Support
// https://github.com/nostr-protocol/nips/blob/master/07.md

import type { NostrEvent } from './types';

// Unsigned event (before signing)
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

// NIP-07 window.nostr interface
interface Nip07Nostr {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<NostrEvent>;
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

// Extend Window interface
declare global {
  interface Window {
    nostr?: Nip07Nostr;
  }
}

// Check if NIP-07 extension is available
export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && typeof window.nostr !== 'undefined';
}

// Get user's public key from NIP-07 extension
export async function getPubkey(): Promise<string> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available');
  }
  return window.nostr!.getPublicKey();
}

// Sign an event using NIP-07 extension
export async function signEvent(event: UnsignedEvent): Promise<NostrEvent> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available');
  }
  return window.nostr!.signEvent(event);
}

// Get relays from NIP-07 extension (if supported)
export async function getRelaysFromExtension(): Promise<string[] | null> {
  if (!isNip07Available() || !window.nostr?.getRelays) {
    return null;
  }
  try {
    const relays = await window.nostr.getRelays();
    // Return write-enabled relays
    return Object.entries(relays)
      .filter(([, config]) => config.write)
      .map(([url]) => url);
  } catch {
    return null;
  }
}
