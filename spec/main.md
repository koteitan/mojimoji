# Specifications
## purpose
- to make a modular-type timeline in nostr.
## UI
- See also: [save.md](save.md) for Save/Load dialog specifications
- See also: [post.md](post.md) for Post dialog specifications
- See also: [timeline.md](timeline.md) for Timeline specifications and future plans
- See also: [mobile-layout.md](mobile-layout.md) for Mobile horizontal scroll layout specifications

User Inrterface is as follows.
- left(bottom for mobile) pane: Timeline list of nostr events:
  - top line: title bar
    - format: "(.>_<)-(.>_<)-mojimoji: Nostr Modular Client"
  - center area: timeline
    - each column: each timeline.
      - 35 charactors width.
      - vertical scrollable area:
        - items: nostr events.
          - kind:1:
            - icon: kind0.content.picture (default avatar if not available)
            - name: kind0.content.name (npub if not available, e.g., "npub1abc...xyz")
            - display_name: kind0.content.display_name (npub if not available)
            - text created at: event.created_at
            - text content: event.content
          - kind:7:
            - icon: kind0.content.picture (default avatar if not available)
            - name: kind0.content.name (npub if not available)
            - display_name: kind0.content.display_name (npub if not available)
            - text created at: event.created_at
            - text: event.content
- center: Graph view: modular connectors of nostr filter by rete.js.
  - top line: toolbars:
    - +Relay button: add a Relay node.
    - +Filter button: dropdown menu with filter node options (same button style):
      - +Operator: add an Operator node.
      - +Search: add a Search node.
      - +Lang: add a Language Filter node.
    - +Timeline button: add a Timeline node.
    - Delete button: delete selected node(s).
    - Save button: open Save dialog.
    - Load button: open Load dialog.
    - | (separator)
    - Post button: open Post dialog (see [post.md](post.md)).
  - bottom-right: footer info
    - version info: "vX.X.X (build timestamp)"
      - build timestamp format:
        - Japanese locale: JST (e.g., "2025-12-07 23:38:00 JST")
        - other locales: UTC (e.g., "2025-12-07 14:38:00 UTC")
    - GitHub link icon
  - center area: graph editor area.
    - nodes:
      - description:
        - nodes inputs data.
        - nodes outputs data:
        - nodes have attributes.
      - common behaviors:
        - node appearance:
          - height: auto-calculated based on content (not fixed)
          - selected border color: green (#4ade80) with box-shadow
        - terminal positions:
          - input terminals are placed at the top center of the node
          - output terminals are placed at the bottom center of the node
        - node placement on add:
          - Relay node: placed at the same Y as the uppermost node, to the right of the rightmost node.
          - Other nodes (Operator, Search, Timeline): placed at the same X as the rightmost node, below the lowermost node.
          - spacing: 50px gap from existing nodes.
        - view centering:
          - after adding a new node, the view is centered on the new node without changing the zoom level.
      - Relay node:
        - output terminal:
          - output (nostr event)
        - attributes:
          - relay source: dropdown select
            - auto (NIP-07→kind:10002): fetch relay URLs from user's kind:10002 event via NIP-07 browser extension
            - manual: use the relay URL textarea below
            - default: auto
            - fallback: manual (if no relay source is set in saved data)
          - relay URL list: multiple line text area (one URL per line)
            - used when relay source is manual, or when auto fails to fetch relays
            - disabled when relay source is auto
          - filters: structured filter UI (NIP-01 compliant)
            - multiple filters (OR logic between filters)
            - each filter:
              - filter header with remove button (×)
              - multiple filter elements (AND logic within filter)
              - each element:
                - dropdown: field name {kinds, ids, authors, #e, #p, #t, since, until, limit}
                - text input: field value (flexible input formats supported)
                  - kinds: comma-separated integers (e.g., "1,6,7")
                  - ids: comma-separated values, supports:
                    - hex (64-char event id)
                    - bech32: note1..., nevent1... (auto-converted to hex internally)
                  - authors: comma-separated values, supports:
                    - hex (64-char pubkey)
                    - bech32: npub1..., nprofile1... (auto-converted to hex internally)
                    - name/display_name: partial match lookup in profile cache (all matches)
                  - #e, #p, #t: comma-separated values, supports:
                    - hex
                    - bech32: npub1..., note1..., nprofile1..., nevent1...
                    - for #p: name/display_name partial match lookup (first match only)
                  - since, until: supports:
                    - unix timestamp (integer)
                    - date only: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (defaults to 00:00:00)
                    - date with time: YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS
                    - time only: HH:MM or HH:MM:SS (defaults to today)
                  - limit: single integer
                - remove button (×) for element (if more than one element)
                - add button (+) on last element to add new element
              - add button (+) at bottom to add new filter
        - default:
          - kinds = 1
          - limit = 200
          - if
            - locale is "ja": relay URL = wss://yabu.me
            - otherwise     : relay URL = wss://relay.damus.io
      - original-filter node:
        - operator node:
          - input terminal:
            - input1 (A)
            - input2 (B)
          - output terminal:
            - output
          - attributes:
            - operator: AND, OR, A-B
          - behavior (signal-based architecture):
            - events flow through graph with signals: 'add' (show) or 'remove' (hide)
            - OR: merge both streams, pass signals as-is
            - AND: emit when event seen from both inputs
            - A-B: events from A pass with their signal, events from B are inverted
              - 'add' in B → 'remove' (x is in B, so exclude from A-B)
              - 'remove' in B → 'add' (x removed from B, so include in A-B if in A)
            - subtraction is processed at Timeline node, allowing late B events to remove already-displayed A events
        - strict search node:
          - input terminal:
            - input
          - output terminal:
            - output
          - attributes:
            - keyword: string
            - regex switch: on, off
            - exclude switch: on, off (when on, filter OUT events matching keyword)
          - behavior:
            - input nostr event and filter by keyword the event.content.
            - when exclude is off: pass events that match the keyword
            - when exclude is on: pass events that do NOT match the keyword
        - language filter node:
          - input terminal:
            - input (nostr event)
          - output terminal:
            - output (nostr event)
          - attributes:
            - language: dropdown select (single language)
              - Japanese (jpn), English (eng), Chinese (cmn), Korean (kor), Spanish (spa), French (fra), German (deu), Portuguese (por), Russian (rus), Arabic (ara)
              - uses ISO 639-3 language codes
          - behavior:
            - detect language of event.content using franc-min library
            - pass events matching selected language
            - events with undetectable language (< 10 chars or "und") are filtered out
            - use Operator node for OR/AND logic with multiple languages
          - library: franc-min (pure JavaScript, 82 languages, ~200KB)
        - nostr filter node:
          - input terminal:
            - input (nostr event)
          - output terminal:
            - output (nostr event)
          - attributes:
            - filter element:
              - dropdown: field name {kinds, authors, #e, #p, #t, since, until}
              - text input: field value
              - field value formats:
                - kinds: comma-separated integers (OR logic), e.g., "1,6,7"
                - authors: comma-separated values (OR logic), supports:
                  - hex (64-char pubkey)
                  - bech32: npub1..., nprofile1...
                  - name/display_name: partial match lookup (all matches)
                - #e: comma-separated event references (OR logic), supports hex, note1..., nevent1...
                - #p: comma-separated pubkey references (OR logic), supports hex, npub1..., name lookup (first match)
                - #t: comma-separated hashtags (OR logic)
                - since, until: supports:
                  - unix timestamp (integer)
                  - date only: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (defaults to 00:00:00)
                  - date with time: YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS
                  - time only: HH:MM or HH:MM:SS (defaults to today)
            - exclude: checkbox (when on, filter OUT events matching criteria)
          - behavior:
            - filter events that have already been fetched (pass-through filter)
            - within a field: OR logic (event matches if ANY value matches)
            - empty values are ignored
            - when exclude is on: invert the result (pass events that do NOT match)
      - Timeline node:
        - input terminal:
          - input (any type - detected dynamically)
        - attributes:
          - timeline name: string
        - behavior:
          - detects input data type dynamically from the connected output
          - receives signals with 'add' or 'remove' type
          - 'add' signal: adds item to timeline (if not duplicate)
          - 'remove' signal: removes item from timeline (if present)
          - out-of-order handling: if 'remove' arrives before 'add', the item ID is tracked in an excluded set
          - type-specific rendering:
            - event kind 0: profile summary (pubkey, name, about, picture)
            - event kind 1: icon, name, display_name, content, datetime
            - event kind others: event id string (bech32)
            - event id: bech32 string
            - pubkey: icon, name, display_name
            - datetime: ISO 8601 string
            - relay: URL strings (one per line)
            - integer, flag, relay status: string representation
      - data-class nodes:
        - constant node:
          - output terminal:
            - output (type based on selection)
          - attributes:
            - type: dropdown select {integer, datetime, event id, pubkey, relay, flag, relay status}
            - value: input field (format depends on type)
              - integer: number input
              - datetime: date/time input
              - event id/pubkey: text input (hex or bech32)
              - relay: textarea (one URL per line)
              - flag: checkbox
              - relay status: dropdown {idle, connecting, sub-stored, EOSE, sub-realtime, closed, error}
          - behavior:
            - outputs constant value based on type selection
            - on change attributes: update value into default value
              - default values:
                - integer: 0
                - datetime: current date/time
                - event id
                - pubkey: NIP-07 pubkey if available, else empty string
                - relay: yabu.me (if locale is "ja"), else damus.io
                - flag: true
                - relay status: EOSE
        - NIP-07 node:
          - output terminal:
            - output (pubkey)
          - behavior:
            - fetches pubkey from NIP-07 browser extension
            - handles unavailable extension case
        - extraction node:
          - input terminal:
            - input (event)
          - output terminal:
            - output (type based on selection)
          - attributes:
            - field: dropdown select {event id, author, created_at, #e, #p, #r}
            - relay filter: dropdown {all, with read, with write, with read and write} (only for #r)
          - behavior:
            - extracts specified field from input events
            - for #e/#p/#r: extracts from event tags
        - multi type relay node (modular relay):
          - input terminals:
            - trigger (trigger type)
            - relay (relay type)
            - dynamic sockets based on filter elements (kinds, limit, since, until, ids, authors, #e, #p)
          - output terminals:
            - output (event)
            - relayStatus (relay status) - emits connection state changes for each relay
          - attributes:
            - filter: structured filter UI (values come from input sockets)
          - behavior:
            - when trigger input receives 1, subscribe to relays with merged filter
            - when trigger input receives 0, stop subscription
            - filter values come from input sockets, not text input
            - relay status output emits {relay: string, status: RelayStatusType} for each connection state change
        - if node:
          - input terminals:
            - A (type based on type selection)
            - B (same type as A)
          - output terminal:
            - output (flag)
          - attributes:
            - type: dropdown {integer, datetime, event id, pubkey, relay, flag, relay status}
            - operator: dropdown:
              - case integer, datetime {=, ≠, <, ≤, >, ≥}
              - case event id, pubkey, relay, relay status, flag {=, ≠}
          - behavior:
            - default output is false (0) when no connection or no input
            - calculates comparison when A or B is updated
        - count node:
          - input terminal:
            - input (event)
          - output terminal:
            - output (integer)
          - behavior:
            - counts the number of input data received
            - outputs current count on each input
    - edges:
      - edges are the connectors between nodes.
        - input: an output terminal of a node.
        - output: an input terminal of a node.
      - the edges has types:
        - event signals (nostr events with add/remove signal)
        - event id
        - pubkey
        - relay
        - flag
        - integer
        - datetime
        - relay status
        - trigger
      - the edges are colored differently by types.
      - only compatible socket types can be connected.
    - sockets (terminals):
      - shape: rounded thin rectangle (40px width x 12px height, 6px border-radius)
      - color: blue (#646cff) default, green (#4ade80) when selected
      - selection highlight: green with box-shadow when selected
    - click-to-connect:
      - first click on a socket: select socket (green highlight)
      - second click on another socket: if compatible types and directions: create connection
      - click elsewhere: cancel pending connection
      - duplicate connections between same sockets are prevented
    - connection deletion:
      - click on socket with existing connection: select connection
      - press Delete/Backspace or click Delete button: delete selected connection

## Behavior
### graph editor navigation
- zoom:
  - by mouse: wheel
  - by touch: pinch (two fingers)
  - zoom range: 0.1 to 2.0
- pan:
  - by mouse: drag on background, right drag
  - by touch: drag on background, two fingers drag
- center view:
  - Center button: fit all nodes in view with toolbar offset adjustment
- node selection:
  - by mouse: click on node: toggle select/unselect the node
  - by touch: tap on node: toggle select/unselect the node
  - click on background: unselect all nodes
  - click on socket: unselect all nodes
  - selected node border color: green (#4ade80)
- multi selection:
  - by mouse: Ctrl+click on node: toggle select/unselect the node
  - by touch: tap on node: toggle select/unselect the node
- deletion:
  - Delete/Backspace/d key: delete selected nodes and connections
  - Delete button (red styled): delete selected nodes and connections
- keyboard shortcuts:
  - r: add Relay node
  - f: toggle Filter dropdown
  - o: add Operator node
  - s: add Search node
  - l: add Language node
  - t: add Timeline node
  - c: center view
  - d: delete selected nodes/connections
  - Ctrl+S: open Save dialog
  - Ctrl+O: open Load dialog
  - Ctrl+P: open Post dialog
  - shortcuts are disabled when focus is on input/textarea/select elements
  - shortcuts (except Ctrl+S/Ctrl+O/Ctrl+P) are disabled when Ctrl/Alt/Meta key is pressed

### on load
- load priority:
  1. Permalink query parameter (`?e=[event-id]`)
     - if URL has `e` query parameter:
       - fetch kind:30078 event from well-known relays
       - load graph from event.content
       - clear query parameter from URL after loading
       - see [save.md](save.md#permalink-loading) for details
  2. localStorage
     - if localStorage has saved graph:
       - automatically load localStorage when the app is started.
  3. Default graph
     - when no permalink and localStorage is empty:
       - create a default graph:
         - one Relay node: default settings, position (100, 100)
         - one Timeline node: position (120, 650)
         - arrangement: vertical (Relay on top, Timeline below)
         - one edge: connect the Relay node output to the Timeline node input.
- centering: fit all nodes in view (same as Center button)

### control input behavior
- text inputs (TextInput, TextArea):
  - changes are applied on blur (losing focus)
  - only dispatch change event when value actually differs from original
- select and checkbox:
  - changes are applied immediately on change

### on change connections
- save:
  - automatically save the graph into localStorage when a node or an edge is added/removed. 

### on attribute change
- when a node attribute is changed:
  - only downstream timelines (connected from the changed node) are cleared
  - the observable pipeline is rebuilt
  - subscriptions are restarted
- exception: display-only attributes (e.g., timeline name) do not trigger pipeline rebuild

### subscription
- When Timeline nodes are connected from Relay nodes, the subscription is started.
- The subscription is implemented by rx-nostr observable.
- When the subscription receives new nostr events, the events are shown in the timelines.
- After the EOSE(End Of Stored Events) is received, the subscription continues to listen to new events.
- Event deduplication: duplicate events (same event ID) are filtered out

### hidden subscriptions:
- There are hidden subscriptions to get profile information for displaying event items:
  - find all the relay nodes for each timeline node.
  - add hidden subscriptions to get kind:0 events for authors found in the timeline events.
  - icon, name, display_name, created_at are extracted from kind:0 events for displaying timeline items.
  - profile requests are batched (up to 50 authors per request, or flush after 100ms)

### profile cache
- Profile data (kind:0 events) is cached in memory and persisted to localStorage
- Cache key: `mojimoji-profile-cache`
- Cache is loaded from localStorage on app startup
- Cache is saved to localStorage with debouncing (500ms delay to batch writes)

### save/load
- Save button or Ctrl+S: open Save dialog
- Load button or Ctrl+O: open Load dialog
- See [save.md](save.md) for detailed Save/Load dialog specifications

### post
- Post button or Ctrl+P: open Post dialog
- See [post.md](post.md) for detailed Post dialog specifications

### debug tools
- Browser console debug functions:
  - dumpgraph(): output graph structure (nodes and connections)
  - dumpsub(): output relay subscription status (ON/OFF)
  - infocache(): output profile cache info (item count and size in bytes)

## Internationalization (i18n)
- Language detection:
  - Detect browser language via `navigator.language`
  - Supported languages: English (en), Japanese (ja)
  - Fallback language: English
- Non-translated UI elements:
  - Title bar: "(>_<)-(>_<)-mojimoji" (keep as-is in all languages)
- Translated UI elements:
  - Toolbar buttons: +Relay, +Filter (dropdown: +Operator, +Search, +Lang), +Timeline, Delete
  - Node labels and placeholders
  - Timeline headers
- Implementation:
  - Use react-i18next library
  - Language files in `src/i18n/locales/`:
    - [en.json](https://github.com/koteitan/koteitan.github.io/blob/main/mojimoji/src/i18n/locales/en.json) - English translations
    - [ja.json](https://github.com/koteitan/koteitan.github.io/blob/main/mojimoji/src/i18n/locales/ja.json) - Japanese translations

## Implementation
- platform:
  - Language: TypeScript
  - Build tool: Vite
  - UI Framework: React
  - Reactive: RxJS (required by rx-nostr)
- libraries:
  - rete.js: for modular connector UI.
  - rete-connection-path-plugin: for custom connection path rendering (vertical bezier curves)
  - rx-nostr v3.x: for nostr subscription.
  - @rx-nostr/crypto: for signing and verification.
  - react-i18next: for internationalization.
  - bech32: for npub encoding (NIP-19).
  - franc-min: for language detection (82 languages, ISO 639-3 codes).
- directory structure:
  ```
  mojimoji/
  ├── index.html
  ├── package.json
  ├── tsconfig.json
  ├── vite.config.ts
  ├── src/
  │   ├── main.tsx
  │   ├── App.tsx
  │   ├── App.css
  │   ├── index.css
  │   ├── components/
  │   │   ├── Timeline/
  │   │   │   ├── Timeline.tsx
  │   │   │   ├── TimelineItem.tsx
  │   │   │   └── Timeline.css
  │   │   ├── Dialogs/
  │   │   │   ├── Dialog.css
  │   │   │   ├── SaveDialog.tsx
  │   │   │   ├── LoadDialog.tsx
  │   │   │   ├── PostDialog.tsx
  │   │   │   └── RelayDialog.tsx
  │   │   └── Graph/
  │   │       ├── GraphEditor.tsx
  │   │       ├── GraphEditor.css
  │   │       ├── CustomNode.tsx
  │   │       ├── CustomNode.css
  │   │       ├── CustomConnection.tsx
  │   │       ├── CustomSocket.tsx
  │   │       └── nodes/
  │   │           ├── index.ts
  │   │           ├── types.ts
  │   │           ├── controls.tsx
  │   │           ├── RelayNode.ts
  │   │           ├── OperatorNode.ts
  │   │           ├── SearchNode.ts
  │   │           ├── LanguageNode.ts
  │   │           ├── NostrFilterNode.ts
  │   │           ├── TimelineNode.ts
  │   │           ├── ConstantNode.ts
  │   │           ├── Nip07Node.ts
  │   │           ├── ExtractionNode.ts
  │   │           ├── MultiTypeRelayNode.ts
  │   │           ├── IfNode.ts
  │   │           └── CountNode.ts
  │   ├── i18n/
  │   │   ├── index.ts
  │   │   └── locales/
  │   │       ├── en.json
  │   │       └── ja.json
  │   ├── graph/
  │   │   └── types.ts
  │   ├── nostr/
  │   │   └── types.ts
  │   └── utils/
  │       └── localStorage.ts
  └── public/
  ```

