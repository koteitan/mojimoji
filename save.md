# graph saving specifications

## saving destinations
- Auto Saving
  - LocalStorage
- Manual Saving
  - to LocalStorage
  - to Nostr Relay
    - public (anyone can find and load)
    - for yourself (filtered by your npub, not encrypted)
  - to File

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
  ]
}
```
- node data formats by type:
  - Relay: `{ relayUrls: string[], filters: Filters }`
  - Operator: `{ operation: "and" | "or" | "a-b" }`
  - Search: `{ searchText: string, exclude: boolean }`
  - Language: `{ language: string }`
  - NostrFilter: `{ filterElements: FilterElement[], exclude: boolean }`
  - Timeline: `{ timelineName: string }`

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
    - Destination tabs: [LocalStorage] [Nostr Relay] [File]
    - Current path: breadcrumb navigation (clickable: root > dir > subdir)
    - Directory browser:
      - [..] (parent directory, if not root)
      - Sub directories (click to enter)
      - Graphs in current directory (click to select for overwrite)
    - Name input: text field for graph name
    - (Nostr tab only):
      - Visibility: [Public] [For yourself] radio buttons
      - Relay URLs: textarea (optional, use graph's relay nodes if empty)
  - South:
    - [Cancel] button
    - [New Folder] button
    - [Save] button

- Load Dialog (modal overlay)
  - North: Title "Load Graph"
  - Center:
    - Source tabs: [LocalStorage] [Nostr Relay] [File]
    - LocalStorage tab:
      - Current path: breadcrumb navigation (clickable: root > dir > subdir)
      - Directory browser:
        - [..] (parent directory, if not root)
        - Sub directories (click to enter)
        - Graphs in current directory (path, savedAt) - click to select
    - Nostr tab:
      - Pubkey input (default: own pubkey if logged in)
      - Visibility filter: [All] [Public only] [Mine only] radio buttons
      - Current path: breadcrumb navigation
      - Directory browser:
        - [..] (parent directory, if not root)
        - Sub directories (click to enter)
        - Graphs in current directory (path, created_at, author) - click to select
    - File tab:
      - [Choose File] button
      - Selected filename display
  - South:
    - [Cancel] button
    - [Load] button

## NIP references
- NIP-78: Application-specific data (kind 30078)
  - https://github.com/nostr-protocol/nips/blob/master/78.md
  - For storing arbitrary app data on relays
- NIP-116 (draft): Event paths (kind 30079)
  - https://github.com/nostr-protocol/nips/pull/1266
  - Proposes path-based event organization (not yet merged)
- NIP-01: Basic protocol
  - https://github.com/nostr-protocol/nips/blob/master/01.md
  - Defines filter structure for subscriptions

