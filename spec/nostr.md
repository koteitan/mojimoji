# Nostr Subscriptions

This document lists all Nostr subscriptions in the codebase, excluding RelayNode and MultiTypeRelayNode (which are user-configurable).

## Subscriptions Table

| category | purpose | strategy | relay URL | kinds | authors | others | limit |
|----------|---------|----------|-----------|-------|---------|----------|-------|
| on load | get user relays | backward | bootstrap | 10002 | browser extension | - | 1 |
| background | load all graphs | backward | user's kind:10002 | 30078 | - | #client: ['mojimoji'] | 500 |
| background | cache profiles for UI | backward | user's kind:10002 or bootstrap | 0 | - | - | 500 |
| on load query | get owner relays | backward | bootstrap | 10002 | graph owner | - | 1 |
| on load query | load graph by nevent | backward | user's kind:10002 | 30078 | - | ids:[query] | 1 |
| on load query | load graph by naddr | backward | relay hints or owner's kind:10002 | naddr | graph owner | #d:naddr | 1 |
| load dialog by author| get graph owner's relays | backward | bootstrap | 10002 | graph owner | - | 1 |
| load dialog by author| find graphs | backward | author's kind:10002 | 30078 | graph owner | - | 100 |
| relay node | subscription by graph| forward | * | *  | * | * | * |
| relay node | fetch profiles of the event | forward | * | 0 | * | - | authors |

## Sending Events Table

| name | relay URL | kind | tags |
|------|-----------|------|------|
| saveGraphToNostr | user's kind:10002 | 30078 | d, client |
| deleteGraphFromNostr | user's kind:10002 | 5 | e, a, k |
| PostDialog | user's kind:10002 | 1 | - |

## Notes

- **bootstrap**: `wss://yabu.me` (Japanese locale) or `wss://relay.damus.io` (other)
- **user's kind:10002**: Logged-in user's relay list fetched from NIP-65 via browser extension
- **author's kind:10002**: Specified author's relay list fetched from NIP-65
- **owner's kind:10002**: Graph owner's relay list fetched from NIP-65
- **bootstrap**: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`, `wss://yabu.me`
- **backward strategy**: One-shot query, completes on EOSE
- **forward strategy**: Continuous subscription, receives real-time updates

## Source Files

- `src/nostr/graphStorage.ts` - Graph save/load operations
- `src/nostr/ProfileFetcher.ts` - Profile batching utility
- `src/nostr/subscription.ts` - Generic subscription helper (used by nodes)
- `src/nostr/client.ts` - Generic client helper
