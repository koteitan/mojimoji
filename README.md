# mojimoji

A modular timeline client for Nostr with visual node-based filtering.

## Usage

### Overview

mojimoji provides a visual graph editor to create custom Nostr timelines by connecting nodes:

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

1. Click on an output socket (bottom of a node) - it turns green
2. Click on an input socket (top of another node)
3. Connection is created

#### Deleting

- Select node(s) by clicking, then press `d` or `Delete`
- Or click the `Delete` button in toolbar

#### Navigation

- **Zoom**: Mouse wheel or pinch gesture
- **Pan**: Drag on background
- **Center**: Press `c` or click `Center` button

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

Note: Shortcuts are disabled when typing in input fields or when Ctrl/Alt/Meta is pressed.

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

- Graph layout and settings are automatically saved to localStorage
- Profile cache is stored for faster loading

## Developer Guide

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

### Local Testing

```bash
# Start dev server with external access (for testing on other devices)
bash scripts/deploy.sh
```

This will start the Vite dev server with `--host` option, allowing access from other devices on the same network.

### Deploy to GitHub Pages

```bash
# Build for GitHub Pages
npm run deploy

# Commit and push
git add -A
git commit -m "Deploy vX.X.X"
git push
```

The deploy script:
1. Builds the app with correct base path (`/mojimoji/`)
2. Copies built files to root directory
3. Restores source `index.html` for future builds

### Project Structure

```
src/
+-- main.tsx              # Entry point
+-- App.tsx               # Main app component
+-- components/
|   +-- Graph/
|   |   +-- GraphEditor.tsx    # Main graph editor
|   |   +-- CustomNode.tsx     # Node renderer
|   |   +-- CustomSocket.tsx   # Socket renderer
|   |   +-- CustomConnection.tsx
|   |   +-- nodes/
|   |       +-- RelayNode.ts   # Relay subscription
|   |       +-- OperatorNode.ts
|   |       +-- SearchNode.ts
|   |       +-- LanguageNode.ts
|   |       +-- TimelineNode.ts
|   +-- Timeline/
|       +-- Timeline.tsx
|       +-- TimelineItem.tsx
+-- i18n/
|   +-- locales/
|       +-- en.json
|       +-- ja.json
+-- nostr/
|   +-- types.ts
+-- utils/
    +-- localStorage.ts
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
