# Specifications
## purpose
- to make a modular-type timeline in nostr.
## UI
User Inrterface is as follows. 
- left(bottom for mobile) pane: Timeline list of nostr events:
  - top line: title
    - (>_<)-(>_<)-mojimoji version x.x.x
  - center area: timeline
    - each column: each timeline.
      - 35 charactors width.
      - vertical scrollable area:
        - items: nostr events.
          - kind:1:
            - icon: kind0.context.picture
            - name: kind0.context.name
            - display_name: kind0.context.display_name
            - text created at: kind0.context.created_at
            - text content: event.context
          - kind:7:
            - icon: kind0.context.picture
            - name: kind0.context.name
            - display_name: kind0.context.display_name
            - text created at: kind0.context.created_at
            - text: event.context
- center: Graph view: modular connectors of nostr filter by rete.js.
  - top line: toolbars:
    - +Relay button: add a Relay node.
    - +Operator button: add an Operator node.
    - +Search button: add a Search node.
    - +Timeline button: add a Timeline node.
    - Delete button: delete selected node(s).
  - center area: graph editor area.
    - nodes:
      - description:
        - nodes inputs data.
        - nodes outputs data:
        - nodes have attributes.
      - common behaviors:
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
          - relay URL list: multiple line text area (size adjusted by new lines automatically)
          - filter list:
            - list item:
              - filter name: {ids, authors, kinds, #?, since, until, limit}
              - filter value: string
              - + button: add a new filter item (on the right end of the last item)
        - default:
          - kinds = [1]
          - limit = 500
          - if 
            - locale is "ja": relay URL = wss://yabu.me
            - otherwise     : relay URL = wss://relay.damus.io
      - original-filter node:
        - operator node:
          - input terminal:
            - input1
            - input2
          - output terminal:
            - output
          - attributes:
            - operator: AND, OR, A-B
        - strict search node:
          - input terminal:
            - input
          - output terminal:
            - output
          - attributes:
            - keyword: string
            - regex switch: on, off
          - behavior:
            - input nostr event and filter by keyword the event.content.
      - Timeline node:
        - input terminal:
          - input (nostr event)
        - attributes:
          - timeline name: string
    - edges:
      - edges are the connectors between nodes.
        - input: an output terminal of a node.
        - output: an input terminal of a node.
      - the edges has types:
        - nostr events
        - relays
        - npubs
      - the edges are colored differently by types.

## Behavior
### graph editor navigation
- zoom:
  - by mouse: wheel
  - by touch: pinch
- pan:
  - by mouse: drag on background, right drag
  - by touch: drag on background, two fingers drag
- node selection:
  - by mouse: click on node: toggle select/unselect the node
  - by touch: tap on node: toggle select/unselect the node
- multi selection:
  - by mouse: Ctrl+click on node: toggle select/unselect the node
  - by touch: tap on node: toggle select/unselect the node
  - Delete/Backspace: delete selected nodes

### on load
- load:
  - automatically load localStorage when the app is started.
  - when the localStorage is empty:
    - create a default graph:
      - one Relay node: default settings
      - one Timeline node: timeline name: "Timeline"
      - one edge: connect the Relay node output to the Timeline node input.

### on change connections
- save:
  - automatically save the graph into localStorage when a node or an edge is added/removed. 

### subscription
- When Timeline nodes are connected from Relay nodes, the subscription is started.
- The subscription is implemented by rx-nostr observable.
- When the subscription receives new nostr events, the events are shown in the timelines.
- After the EOSE(End Of Stored Events) is received, the subscription continues to listen to new events.

### nostr-filter resolution
- There are hidden subscriptions:
  - kind:0: to get profile information.

## Internationalization (i18n)
- Language detection:
  - Detect browser language via `navigator.language`
  - Supported languages: English (en), Japanese (ja)
  - Fallback language: English
- Non-translated UI elements:
  - Title bar: "(>_<)-(>_<)-mojimoji" (keep as-is in all languages)
- Translated UI elements:
  - Toolbar buttons: +Relay, +Operator, +Search, +Timeline, Delete
  - Node labels and placeholders
  - Timeline headers
- Implementation:
  - Use react-i18next library
  - Language files in `src/i18n/locales/`:
    - `en.json` - English translations
    - `ja.json` - Japanese translations

## Implementation
- platform:
  - Language: TypeScript
  - Build tool: Vite
  - UI Framework: React
  - Reactive: RxJS (required by rx-nostr)
- libraries:
  - rete.js: for modular connector UI.
  - rx-nostr v3.x: for nostr subscription.
  - @rx-nostr/crypto: for signing and verification.
- directory structure:
  ```
  momimomi/
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
  │   │   └── Graph/
  │   │       ├── GraphEditor.tsx
  │   │       └── nodes/
  │   │           ├── RelayNode.ts
  │   │           ├── OperatorNode.ts
  │   │           ├── SearchNode.ts
  │   │           └── TimelineNode.ts
  │   ├── nostr/
  │   │   ├── client.ts
  │   │   ├── subscription.ts
  │   │   └── types.ts
  │   ├── store/
  │   │   └── graphStore.ts
  │   └── utils/
  │       └── localStorage.ts
  └── public/
  ```

