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
    - +Source button: add a Source node.
    - +Operator button: add an Operator node.
    - +Search button: add a Search node.
    - +Display button: add a Display node.
    - Delete button: delete selected node(s).
  - center area: graph editor area.
    - nodes:
      - description:
        - nodes inputs data.
        - nodes outputs data:
        - nodes have attributes.
      - Source node:
        - output terminal:
          - output (nostr event)
        - attributes:
          - relay URL list
          - filter list:
            - list item:
              - filter name: ids, authors, kinds, #?, since, until, limit
              - filter value: string
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
      - display node:
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
### on load
- load:
  - automatically load localStorage when the app is started.

### on change connections
- save:
  - automatically save when a node or an edge is added/removed. 

### subscription
- When display nodes are connected from the source nodes, the subscription is started.
- The subscription is implemented by rx-nostr observable.
- When the subscription receives new nostr events, the events are shown in the timelines.
- After the EOSE(End Of Stored Events) is received, the subscription continues to listen to new events.

### nostr-filter resolution
- There are hidden subscriptions:
  - kind:0: to get profile information.
- localStorage:
  - saved data:
    - whole connectgion of nodes and edges in the center pane.

## Internationalization (i18n)
- Language detection:
  - Detect browser language via `navigator.language`
  - Supported languages: English (en), Japanese (ja)
  - Fallback language: English
- Non-translated UI elements:
  - Title bar: "(>_<)-(>_<)-mojimoji" (keep as-is in all languages)
- Translated UI elements:
  - Toolbar buttons: +Source, +Operator, +Search, +Display, Delete
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
  │   │           ├── SourceNode.ts
  │   │           ├── OperatorNode.ts
  │   │           ├── SearchNode.ts
  │   │           └── DisplayNode.ts
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

