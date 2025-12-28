# Nostr Subscriptions

This document lists all Nostr subscriptions in the codebase, excluding SimpleRelayNode and ModularRelayNode (which are user-configurable).

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

## Profile Caching Architecture

```
profileCache.ts (Core cache module)
├── Map<pubkey, Profile> (in-memory)
├── localStorage persistence (load on init, debounced save)
├── getCachedProfile(pubkey) → Profile
├── saveProfileToCache(pubkey, profile)
├── getAllCachedProfiles() → Array<{pubkey, profile}>
├── findPubkeysByName(searchTerm) → pubkey[]
├── getProfileCache() → Map
└── getProfileCacheInfo() → {count, bytes}

ProfileFetcher.ts (Batching utility class)
├── Uses profileCache internally
├── Batches requests (50 items or 1000ms timeout)
├── Backward subscription (EOSE ends subscription)
├── queueRequest(pubkey) - add to batch queue
├── flushBatch() - emit batched request
└── start(callback) / stop()

graphStorage.ts
└── fetchAndCacheProfiles() - bulk fetch profiles on app load (uses saveProfileToCache)

Usage:
├── profileCache.ts
│   ├── getCachedProfile()
│   │   ├── SimpleRelayNode.ts → console log (debug)
│   │   ├── GraphEditor.tsx → Timeline (display author name/avatar)
│   │   ├── LoadDialog.tsx → author display in graph list
│   │   ├── PostDialog.tsx → user profile display
│   │   └── SaveDialog.tsx → author display in graph list
│   ├── saveProfileToCache()
│   │   ├── ProfileFetcher.ts → on profile received from relay
│   │   └── graphStorage.ts (fetchAndCacheProfiles) → bulk fetch on app load
│   ├── getAllCachedProfiles()
│   │   └── LoadDialog.tsx → author search autocomplete
│   ├── findPubkeysByName()
│   │   ├── SimpleRelayNode.ts → author filter autocomplete
│   │   ├── ModularRelayNode.ts → author filter autocomplete
│   │   └── NostrFilterNode.ts → author filter autocomplete
│   ├── getProfileCache()
│   │   └── SimpleRelayNode.ts → identifier resolution (npub/name lookup)
│   └── getProfileCacheInfo()
│       └── GraphEditor.tsx → debug panel (cache count/size)
└── ProfileFetcher.ts
    ├── SimpleRelayNode.ts → profile$ → GraphEditor.tsx → Timeline (display author name/avatar)
    └── ModularRelayNode.ts → profile$ → GraphEditor.tsx → Timeline (display author name/avatar)
```

### Flow

1. **On app load**:
   - profileCache loads from localStorage
   - `fetchAndCacheProfiles()` fetches profiles from relays (bulk, one-shot)
2. **On SimpleRelayNode start**: ProfileFetcher starts backward subscription
3. **On event received**:
   - Check cache via `getCachedProfile()`
   - If not cached, `queueRequest()` adds to batch
   - After 1000ms or 50 items, `flushBatch()` emits REQ
4. **On profile received**:
   - `saveProfileToCache()` stores in Map + localStorage
   - Callback notifies SimpleRelayNode

## Source Files

- `src/nostr/nostr.ts` - Relay list utilities, rx-nostr singleton
- `src/nostr/graphStorage.ts` - Graph save/load operations
- `src/nostr/profileCache.ts` - Profile cache with localStorage
- `src/nostr/ProfileFetcher.ts` - Profile batching utility
- `src/nostr/nip07.ts` - NIP-07 browser extension support
- `src/nostr/types.ts` - Type definitions and utilities
