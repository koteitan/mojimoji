# Implementation Checklist

## Phase 1: Project Setup
- [ ] Initialize Vite + React + TypeScript project
- [ ] Install dependencies (rete.js, rx-nostr, @rx-nostr/crypto, rxjs)
- [ ] Configure TypeScript (tsconfig.json)
- [ ] Configure Vite (vite.config.ts)
- [ ] Create directory structure

## Phase 2: Basic UI Layout
- [ ] Create App component with left/center pane layout
- [ ] Implement responsive layout (left pane for desktop, bottom for mobile)
- [ ] Add basic CSS styling

## Phase 3: Rete.js Graph Editor
- [ ] Set up Rete.js editor in center pane
- [ ] Create base node class
- [ ] Implement Source node (relay URL, filter attributes)
- [ ] Implement Operator node (AND, OR, A-B)
- [ ] Implement Search node (keyword, regex)
- [ ] Implement Display node (timeline name)
- [ ] Define edge types (nostr events, relays, npubs)
- [ ] Style edges by type (color coding)

## Phase 4: Nostr Integration
- [ ] Set up rx-nostr client (src/nostr/client.ts)
- [ ] Define nostr event types (src/nostr/types.ts)
- [ ] Implement subscription manager (src/nostr/subscription.ts)
- [ ] Handle kind:0 (profile) events
- [ ] Handle kind:1 (text note) events
- [ ] Handle kind:7 (reaction) events
- [ ] Implement EOSE handling and continuous listening

## Phase 5: Timeline Display
- [ ] Create Timeline component
- [ ] Create TimelineItem component
- [ ] Display kind:1 events (icon, name, display_name, created_at, content)
- [ ] Display kind:7 events (icon, name, display_name, created_at, content)
- [ ] Implement vertical scrolling
- [ ] Style timeline (35 character width)

## Phase 6: Graph-to-Subscription Bridge
- [ ] Connect Display nodes to Timeline components
- [ ] Implement filter resolution from node connections
- [ ] Start subscription when Display node is connected to Source
- [ ] Stop subscription when connection is removed
- [ ] Route filtered events to correct Timeline

## Phase 7: Persistence
- [ ] Implement localStorage save (src/utils/localStorage.ts)
- [ ] Save graph state on node/edge changes
- [ ] Load graph state on app start
- [ ] Implement graph store (src/store/graphStore.ts)

## Phase 8: Polish
- [ ] Add i18n support (English/Japanese by browser locale)
- [ ] Error handling for relay connections
- [ ] Loading states
- [ ] Performance optimization
- [ ] Testing

## Phase 9: Deployment
- [ ] Build for production
- [ ] Deploy to GitHub Pages
