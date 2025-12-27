# Nostr Subscriptions

This document lists all Nostr subscriptions in the codebase, excluding RelayNode and MultiTypeRelayNode (which are user-configurable).

## Subscriptions Table

| name | strategy | relay URL | kinds | authors | filter 2 | limit |
|------|----------|-----------|-------|---------|----------|-------|
| fetchUserRelays | backward | bootstrap | 10002 | [pubkey] | - | 1 |
| loadGraphsFromNostr (mine) | backward | kind:10002 | 30078 | [userPubkey] | - | 100 |
| loadGraphsFromNostr (by-author) | backward | kind:10002 | 30078 | [authorPubkey] | - | 100 |
| loadGraphsFromNostr (public) | backward | bootstrap | 30078 | - | #public: [''] | 100 |
| loadGraphByPath | backward | kind:10002 or bootstrap | 30078 | [pubkey] | #d: [path] | 1 |
| loadGraphByEventId | backward | PERMALINK_RELAYS | 30078 | - | ids: [eventId] | 1 |
| loadGraphByNaddr | backward | relay hints or kind:10002 | [kind] | [pubkey] | #d: [dTag] | 1 |
| fetchAndCacheProfiles | backward | kind:10002 or bootstrap | 0 | - | - | 500 |
| ProfileFetcher | forward | (from caller) | 0 | [pubkeys] | - | authors.length |

## Notes

- **bootstrap**: `wss://yabu.me` (Japanese locale) or `wss://relay.damus.io` (other)
- **kind:10002**: User's relay list fetched from NIP-65
- **PERMALINK_RELAYS**: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`, `wss://yabu.me`
- **backward strategy**: One-shot query, completes on EOSE
- **forward strategy**: Continuous subscription, receives real-time updates

## Source Files

- `src/nostr/graphStorage.ts` - Graph save/load operations
- `src/nostr/ProfileFetcher.ts` - Profile batching utility
- `src/nostr/subscription.ts` - Generic subscription helper (used by nodes)
- `src/nostr/client.ts` - Generic client helper
