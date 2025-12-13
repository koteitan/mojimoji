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
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"],
    ["client", "mojimoji"]
  ],
  "content": "[graph data as JSON string]",
  "sig": "[signature]"
}
```
Note:
- Visibility is stored in the graph data content (API version 2+)
- When loading older (version 1) events, visibility falls back to checking the `["public"]` Nostr tag

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
  "version": 2,
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
  },
  "visibility": "public" | "for yourself"
}
```
- version: API version for data migration (current: 2)
  - Version 1: Initial version
  - Version 2: Added visibility field to graph data (moved from Nostr tag)
- node data formats by type:
  - Relay: `{ relaySource?: "auto" | "manual", relayUrls: string[], filters: Filters }`
    - relaySource: optional, defaults to "manual" for backward compatibility
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
  - Header:
    - Title "Save Graph"
    - [×] close button
  - Content:
    - "Save to:" label
    - Destination tabs: [Browser] [Nostr Relay] [File]
    - Destination description (changes based on selected tab)
    - (Browser/Nostr tabs only):
      - "path:" label + Current path: breadcrumb navigation (clickable: root > dir > subdir)
      - Directory browser (min-height: 2 lines):
        - [..] (parent directory, if not root)
        - Sub directories: [📁] [name] [× delete button] (click to enter, delete only for Browser)
        - Graphs: [📄] [name] [author icon] [author name] [saved time] [× delete button] (click to select for overwrite, author info shown for Nostr only)
        - Loading animation when fetching from Nostr relay
    - Name input: text field for graph name
    - (Nostr tab only):
      - Visibility: [For yourself] [Public] radio buttons (default: For yourself)
      - Visibility description text
      - Relay URLs: textarea (pre-populated with kind:10002 relay list)
      - "as:" label + User info display: [icon] [name] (from kind:0 profile, uses "name" field)
    - Error message (if any)
  - Footer:
    - [Cancel] button
    - [New Folder] button (Browser/Nostr tabs only, creates session-only folder)
    - [Save] button (primary)

- Load Dialog (modal overlay)
  - Header:
    - Title "Load Graph"
    - [×] close button
  - Content (note: Nostr tab content comes before Browser tab content, different from Save Dialog):
    - "Load from:" label
    - Source tabs: [Browser] [Nostr Relay] [File] (default: Browser)
    - Source description (changes based on selected tab)
    - Nostr tab:
      - Relay list:
        - caption: "Load from relays (default: kind:10002)"
        - textarea: pre-populated with kind:10002 relay list
      - Filter: [For yourself] [Public] [By author] radio buttons (default: For yourself)
        - Visibility filter behavior:

          | Filter       | My "For yourself" | My "Public" | Other's "For yourself" | Other's "Public" |
          |--------------|-------------------|-------------|------------------------|------------------|
          | For yourself | ✔                 |             |                        |                  |
          | Public       |                   | ✔           |                        | ✔                |
          | By author    | ✔ (if me)         | ✔ (if me)   | ✔                      | ✔                |

      - (By author only): Author input with autocomplete
        - text input for npub, hex, or name
        - dropdown suggestions: [icon] [name] (from cached kind:0 profiles)
        - searches both display_name and name fields
    - Browser tab:
      - "path:" label + Current path: breadcrumb navigation (clickable: root > dir > subdir)
      - Directory browser (min-height: 2 lines):
        - [..] (parent directory, if not root)
        - Sub directories: [📁] [name] [× delete button] (click to enter)
        - Graphs: [📄] [name] [author icon] [author name] [created_at] [× delete button for own graphs] (click to select)
        - Loading animation when fetching from Nostr relay
    - Error message (if any)
  - Footer:
    - [Cancel] button
    - [Load] button (primary)

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
- For public graphs (version 1): query with `{ kinds: [30078], "#public": [""] }`
- For public graphs (version 2): visibility is stored in graph data, client-side filtering is applied

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

