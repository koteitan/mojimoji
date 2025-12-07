# Implementation Checklist

## Phase 1: Project Setup
- [x] Initialize Vite + React + TypeScript project
- [x] Install dependencies (rete.js, rx-nostr, @rx-nostr/crypto, rxjs)
- [x] Configure TypeScript (tsconfig.json)
- [x] Configure Vite (vite.config.ts)
- [x] Create directory structure

## Phase 2: Basic UI Layout
- [x] Create App component with left/center pane layout
- [x] Implement responsive layout (left pane for desktop, bottom for mobile)
- [x] Add basic CSS styling

## Phase 3: Rete.js Graph Editor
- [x] Set up Rete.js editor in center pane
- [x] Create base node class
- [x] Implement Source node (relay URL, filter attributes)
- [x] Implement Operator node (AND, OR, A-B)
- [x] Implement Search node (keyword, regex)
- [x] Implement Display node (timeline name)
- [ ] Define edge types (nostr events, relays, npubs)
- [ ] Style edges by type (color coding)

## Phase 4: Nostr Integration
- [x] Set up rx-nostr client (src/nostr/client.ts)
- [x] Define nostr event types (src/nostr/types.ts)
- [x] Implement subscription manager (src/nostr/subscription.ts)
- [x] Handle kind:0 (profile) events
- [x] Handle kind:1 (text note) events
- [x] Handle kind:7 (reaction) events
- [x] Implement EOSE handling and continuous listening

## Phase 5: Timeline Display
- [x] Create Timeline component
- [x] Create TimelineItem component
- [x] Display kind:1 events (icon, name, display_name, created_at, content)
- [x] Display kind:7 events (icon, name, display_name, created_at, content)
- [x] Implement vertical scrolling
- [ ] Style timeline (35 character width)

## Phase 6: Graph-to-Subscription Bridge
- [x] Connect Display nodes to Timeline components
- [x] Implement filter resolution from node connections
- [x] Start subscription when Display node is connected to Source
- [x] Stop subscription when connection is removed
- [x] Route filtered events to correct Timeline

## Phase 7: Persistence
- [x] Implement localStorage save (src/utils/localStorage.ts)
- [x] Save graph state on node/edge changes
- [x] Load graph state on app start
- [x] Implement graph store (src/store/graphStore.ts)

## Phase 8: Polish
- [ ] Add i18n support (English/Japanese by browser locale)
- [ ] Error handling for relay connections
- [ ] Loading states
- [ ] Performance optimization
- [ ] Testing

## Phase 9: Deployment
- [x] Build for production
- [ ] Deploy to GitHub Pages
