# mojimoji

A modular filter previewer for Nostr. modular + moderation = mojimoji

## Usage

- **Relay Node**: Connect to Nostr relays and fetch events
- **Filter Nodes**: Filter events by criteria (Operator, Search, Language)
- **Timeline Node**: Display filtered events

### Getting Started

1. Open the application in your browser
2. A default graph with Relay -> Timeline is created
3. Events will start appearing in the timeline panel on the left

### Graph Editor

#### Adding Nodes

- Click toolbar buttons: `+Relay`, `+Filter`, `+Timeline`
- Or use keyboard shortcuts (see below)

#### Connecting Nodes

1. Click on a socket (it turns green)
2. Click on another socket (connection is created)

#### Deleting

- **Nodes**: Select node(s) by clicking, then press `d` or `Delete`. Or click the `Delete` button in toolbar
- **Connections**: Click on a socket (endpoint), then press `d` or `Delete`. Or click the `Delete` button in toolbar

#### Navigation

- **Zoom**: Mouse wheel or pinch gesture
- **Pan**: Drag on background
- **Center**: Press `c` or click `Center` button

#### Saving and Loading

- **Save**: Click `Save` button or press `Ctrl+S`
  - Save to Browser (localStorage), Nostr Relay, or File
- **Load**: Click `Load` button or press `Ctrl+O`
  - Load from Browser, Nostr Relay, or File

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| r | Add Relay node |
| f | Toggle Filter dropdown |
| o | Add Operator node |
| s | Add Search node |
| l | Add Language node |
| t | Add Timeline node |
| c | Center view |
| d | Delete selected |
| Ctrl+S | Save graph |
| Ctrl+O | Load graph |

### Node Types

#### Relay Node
- **Relay URLs**: Enter relay WebSocket URLs (one per line)
- **Filters**: Configure NIP-01 filters (kinds, authors, etc.)

#### Operator Node
- Combine two event streams with AND, OR, or A-B (difference)

#### Search Node
- Filter events by keyword or regex pattern

#### Language Node
- Filter events by detected language (Japanese, English, Chinese, etc.)

#### Timeline Node
- Display events in a scrollable list
- Set a custom timeline name

### Data Persistence

- Graph layout and settings are saved to localStorage on focus lost
- Profile cache is stored for faster loading

## Developer Guide

### Documentation

| Document | Description |
|----------|-------------|
| [spec/main.md](spec/main.md) | Main specifications (UI, Behavior, i18n, Implementation) |
| [spec/save.md](spec/save.md) | Save/Load dialog specifications |
| [spec/save-ja.md](spec/save-ja.md) | Save/Load dialog specifications (Japanese) |
| [spec/timeline.md](spec/timeline.md) | Timeline specifications and future plans (NIP-36, images) |
| [clients.md](clients.md) | Nostr clients comparison |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Third-party library licenses |
| [README-ja.md](README-ja.md) | README (Japanese) |

### Tech Stack

- **Language**: TypeScript
- **Build Tool**: Vite
- **UI Framework**: React
- **Graph Editor**: rete.js
- **Nostr Client**: rx-nostr
- **Reactive**: RxJS
- **i18n**: react-i18next

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Type check
npm run tsc
```

### Deploy to GitHub Pages

Deployment is automated via GitHub Actions. Just push to `main` branch:

```bash
git push
```

GitHub Actions will automatically:
1. Install dependencies
2. Build the app with correct base path (`/mojimoji/`)
3. Deploy to GitHub Pages

### Project Structure

```
src/
+-- main.tsx                    # Entry point
+-- App.tsx                     # Main app component, version info
+-- components/
|   +-- Graph/
|   |   +-- GraphEditor.tsx     # Main graph editor, node wiring, pipeline
|   |   +-- GraphEditor.css     # Graph editor styles
|   |   +-- CustomNode.tsx      # Node UI renderer, control components
|   |   +-- CustomNode.css      # Node styles (sockets, controls, toggle)
|   |   +-- CustomSocket.tsx    # Socket renderer
|   |   +-- CustomConnection.tsx # Connection renderer
|   |   +-- nodes/
|   |       +-- index.ts        # Node exports
|   |       +-- types.ts        # Socket type definitions
|   |       +-- controls.tsx    # Control classes (TextInput, Select, etc.)
|   |       +-- RelayNode.ts    # Simple relay node (direct config)
|   |       +-- MultiTypeRelayNode.ts  # Modular relay node (socket inputs)
|   |       +-- OperatorNode.ts # AND/OR/A-B set operations
|   |       +-- SearchNode.ts   # Keyword/regex filter
|   |       +-- LanguageNode.ts # Language detection filter
|   |       +-- NostrFilterNode.ts    # NIP-01 filter pass-through
|   |       +-- TimelineNode.ts # Display events with dynamic type detection
|   |       +-- ConstantNode.ts # Constant value output (int, pubkey, etc.)
|   |       +-- Nip07Node.ts    # NIP-07 extension pubkey
|   |       +-- ExtractionNode.ts     # Extract fields from events
|   |       +-- IfNode.ts       # Conditional comparison
|   |       +-- CountNode.ts    # Event counter
|   +-- Timeline/
|   |   +-- Timeline.tsx        # Timeline panel component
|   |   +-- Timeline.css        # Timeline styles
|   |   +-- TimelineItem.tsx    # Individual timeline item renderer
|   +-- Dialogs/
|       +-- index.ts            # Dialog exports
|       +-- SaveDialog.tsx      # Save dialog (Browser/Nostr/File)
|       +-- LoadDialog.tsx      # Load dialog
|       +-- PostDialog.tsx      # Post dialog
+-- i18n/
|   +-- index.ts                # i18n initialization
|   +-- locales/
|       +-- en.json             # English translations
|       +-- ja.json             # Japanese translations
+-- nostr/
|   +-- types.ts                # Nostr event/profile types
|   +-- client.ts               # RxNostr client setup
|   +-- subscription.ts         # Subscription management
|   +-- nip07.ts                # NIP-07 browser extension interface
|   +-- graphStorage.ts         # Save/load graphs to Nostr relays
|   +-- profileCache.ts         # Profile (kind:0) caching with localStorage
|   +-- ProfileFetcher.ts       # Batched profile fetching utility
+-- utils/
    +-- localStorage.ts         # Graph save/load to localStorage
```

### Debug Tools

Open browser console and run:

- `dumpgraph()` - Output graph structure
- `dumpsub()` - Output relay subscription status
- `infocache()` - Output profile cache info

### Adding a New Node Type

1. Create `src/components/Graph/nodes/YourNode.ts`
2. Export from `src/components/Graph/nodes/index.ts`
3. Add to `NodeTypes` union in `GraphEditor.tsx`
4. Add case in `addNode()` function
5. Add wiring logic in `rebuildPipeline()`
6. Add i18n translations in `locales/*.json`
7. Update `spec.md`

### Code Style

- Use TypeScript strict mode
- Follow existing patterns for node implementation
- Add `DEBUG` flag for development logs
- Keep bundle size minimal

### References

- [rete.js Documentation](https://rete.js.org/)
- [rx-nostr Documentation](https://penpenpng.github.io/rx-nostr/)
- [NIP-01 Specification](https://github.com/nostr-protocol/nips/blob/master/01.md)

## License

MIT

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for third-party library licenses.
