# graph saving specifications

## saving destinations
- Auto Saving
  - Browser (localStorage)
- Manual Saving
  - to Browser (localStorage)
    - Graphs are stored in browser's localStorage
    - Deleted when browser cache is cleared
  - to Nostr Relay
    - public (anyone can find and load)
    - for yourself (filtered by your npub, not encrypted)
  - to File
    - Download as JSON file to computer

## saving formats

### json format

#### in Nostr Relay (NIP-78 event)
```json
// Public
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"],
    ["public"]
  ],
  "content": "[graph data as JSON string]",
  "sig": "[signature]"
}

// For yourself (no public tag)
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"]
  ],
  "content": "[graph data as JSON string]",
  "sig": "[signature]"
}
```
- Public: has `["public"]` tag, searchable by anyone using `#public` filter
- For yourself: no `public` tag, search requires `authors` filter with your pubkey

#### in LocalStorage
Current localStorage keys used by mojimoji:
- `mojimoji-graph`: auto-saved graph data (current working graph)
- `mojimoji-profile-cache`: cached user profiles (kind:0 events)

For manual saving, we will add:
- `mojimoji-saved-graphs`: array of saved graphs

```json
// mojimoji-graph (auto-save, single graph)
[graph data]

// mojimoji-profile-cache (profile cache)
{
  "[pubkey]": {
    "name": "string",
    "display_name": "string",
    "picture": "url",
    "about": "string",
    "nip05": "string"
  },
  ...
}

// mojimoji-saved-graphs (manual saves, array of graphs)
[
  {
    "path": "[graph path]",
    "data": [graph data],
    "savedAt": [unix-timestamp]
  },
  ...
]
```

#### in File
```json
{
  "path": "[graph path]",
  "data": [graph data]
}
```

### graph path
- format: `[graph directory]/[graph name]`
- graph directory: `[dir]/[subdir]/[subdir]/.../[subdir]`
- graph name: `[name]`
- note: NIP-116 (draft) proposes kind 30079 for path-based events with `d` tag for full path and `f` tag for directory, but it is not yet merged. For now, we use NIP-78 (kind 30078) with our own path convention in the `d` tag.

### graph data
```json
{
  "nodes": [
    {
      "id": "[node-id]",
      "type": "Relay" | "Operator" | "Search" | "Language" | "NostrFilter" | "Timeline",
      "position": { "x": number, "y": number },
      "data": { ... }
    },
    ...
  ],
  "connections": [
    {
      "id": "[connection-id]",
      "source": "[source-node-id]",
      "sourceOutput": "[output-socket-key]",
      "target": "[target-node-id]",
      "targetInput": "[input-socket-key]"
    },
    ...
  ],
  "viewTransform": {
    "x": number,
    "y": number,
    "k": number
  }
}
```
- node data formats by type:
  - Relay: `{ relayUrls: string[], filters: Filters }`
  - Operator: `{ operation: "and" | "or" | "a-b" }`
  - Search: `{ searchText: string, exclude: boolean }`
  - Language: `{ language: string }`
  - NostrFilter: `{ filterElements: FilterElement[], exclude: boolean }`
  - Timeline: `{ timelineName: string }`
- viewTransform: graph editor view position (pan and zoom)
  - x, y: pan offset in pixels
  - k: zoom scale factor (1.0 = 100%)

### (reference) Current auto saving format for LocalStorage
- localStorage key: `mojimoji-graph`
- format: same as [graph data](#graph-data)

## Saving UI Specifications

### View Transition
- Graph Editor View (main)
  - Click "Save" button -> Save Dialog
  - Click "Load" button -> Load Dialog
  - Ctrl+S -> Save Dialog
  - Ctrl+O -> Load Dialog
- Save Dialog
  - Click "Save" -> save and close -> Graph Editor View
  - Click "Cancel" / Press Escape -> Graph Editor View
- Load Dialog
  - Select graph, Click "Load" -> load and close -> Graph Editor View
  - Click "Cancel" / Press Escape -> Graph Editor View

### View Arrangements
- Graph Editor View (existing, add buttons to toolbar)
  - Top: Toolbar
    - existing buttons...
    - [Save] button (new)
    - [Load] button (new)
  - Center: Graph editor canvas
  - Bottom-right: Version info + GitHub link

- Save Dialog (modal overlay)
  - North: Title "Save Graph"
  - Center:
    - "Save to:" label
    - Destination tabs: [Browser] [Nostr Relay] [File]
    - Destination description (changes based on selected tab)
    - Current path: breadcrumb navigation (clickable: root > dir > subdir)
    - Directory browser:
      - [..] (parent directory, if not root)
      - Sub directories: [icon] [name] [delete button] (click to enter)
      - Graphs: [icon] [name] [saved time] [delete button] (click to select for overwrite)
    - Name input: text field for graph name
    - (Nostr tab only):
      - Visibility: [Public] [For yourself] radio buttons (default: For yourself)
      - Relay URLs: textarea (optional, use kind:10002 relay list if empty)
  - South:
    - [Cancel] button
    - [New Folder] button (creates session-only folder, not persisted)
    - [Save] button

- Load Dialog (modal overlay)
  - North: Title "Load Graph"
  - Center:
    - "Load from:" label
    - Source tabs: [Browser] [Nostr Relay] [File]
    - Source description (changes based on selected tab)
    - Browser tab:
      - Current path: breadcrumb navigation (clickable: root > dir > subdir)
      - Directory browser:
        - [..] (parent directory, if not root)
        - Sub directories: [icon] [name] [delete button] (click to enter)
        - Graphs: [icon] [name] [saved time] [delete button] (click to select)
    - Nostr tab:
      - Pubkey input (default: own pubkey if logged in)
      - Visibility filter: [All] [Public only] [Mine only] radio buttons
      - Current path: breadcrumb navigation
      - Directory browser:
        - [..] (parent directory, if not root)
        - Sub directories: [icon] [name] (click to enter)
        - Graphs: [icon] [name] [created_at] [author icon] [author name] [delete button for own graphs] (click to select)
          - author icon/name: from kind:0 profile event (picture, display_name or name)
    - File tab:
      - [Choose File] button
      - Selected filename display
  - South:
    - [Cancel] button
    - [Load] button

### Directory Structure
- Directories are derived from graph paths (no explicit directory storage)
- New Folder creates session-only folders (visible until dialog closes)
- Folders with saved graphs persist as long as the graphs exist

## Nostr Relay Saving/Loading

### Signing with NIP-07
- Use NIP-07 browser extension (e.g., nos2x, Alby) for signing events
- Call `window.nostr.signEvent(event)` to sign the event before publishing
- Call `window.nostr.getPublicKey()` to get the user's public key

### Default Relay List (kind:10002)
- When saving to Nostr Relay, use the user's relay list from kind:10002 events as default
- Fetch kind:10002 events from well-known relays using the user's pubkey from NIP-07
- Parse relay list from the `r` tags in the event
- User can override with custom relay URLs in the save dialog

### Loading from Nostr Relay
- Use the pubkey from NIP-07 browser extension as default search pubkey
- Query relays with filter: `{ kinds: [30078], authors: [pubkey], "#d": ["mojimoji/graphs/..."] }`
- For public graphs, also query with: `{ kinds: [30078], "#public": [""] }`

## Deletion

### Browser Storage
- Delete button appears on hover for graphs and folders
- Graph deletion: Immediate removal from localStorage
- Folder deletion: Removes all graphs within folder (recursive)
- Confirmation dialog shown before deletion

### Nostr Relay (NIP-09)
- Only the author (same pubkey) can delete their own events
- Other users' public graphs cannot be deleted (no delete button shown)
- Deletion request format (kind:5):
```json
{
  "kind": 5,
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "tags": [
    ["a", "30078:[user-pubkey]:mojimoji/graphs/[path]"],
    ["k", "30078"]
  ],
  "content": "",
  "sig": "[signature]"
}
```
- Relays SHOULD delete all versions up to deletion request timestamp
- Deletion is not guaranteed (distributed system limitation)

### UI Behavior
- Browser: Delete button shown for all items (all graphs are user's own)
- Nostr Relay: Delete button shown only for user's own graphs (author === user's pubkey)

## NIP references
- NIP-01: Basic protocol
  - https://github.com/nostr-protocol/nips/blob/master/01.md
  - Defines filter structure for subscriptions
- NIP-07: Browser extension for signing
  - https://github.com/nostr-protocol/nips/blob/master/07.md
  - Provides `window.nostr` API for signing and pubkey access
- NIP-09: Event Deletion Request
  - https://github.com/nostr-protocol/nips/blob/master/09.md
  - Defines kind:5 deletion request events
- NIP-65: Relay List Metadata (kind 10002)
  - https://github.com/nostr-protocol/nips/blob/master/65.md
  - Stores user's preferred relay list
- NIP-78: Application-specific data (kind 30078)
  - https://github.com/nostr-protocol/nips/blob/master/78.md
  - For storing arbitrary app data on relays
- NIP-116 (draft): Event paths (kind 30079)
  - https://github.com/nostr-protocol/nips/pull/1266
  - Proposes path-based event organization (not yet merged)

