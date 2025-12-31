# Event Processing and Subscription Flow

This document describes when and how subscriptions, node chains, event emissions, and user editing are processed.

## Overview

```mermaid
flowchart LR
    A[User Action] --> B[Control Change]
    B --> C[Save Graph]
    C --> D[Rebuild Pipeline]
    D --> E[Start Subscriptions]
    E --> F[Events Flow]
    F --> G[Timeline Update]
```

## 1. Pipeline Rebuild Process

### Prerequisite: Graph Structure vs Observable Wiring

- **Graph Structure (Edge/Connection)**: Connection lines in rete.js editor. Already exists from user editing.
- **Observable Wiring (setInput)**: RxJS subscribe. Set up during rebuildPipeline().

Step 2 "traversal" refers to the existing graph structure, and steps 4-12 set up the Observables.

### Execution Order

```mermaid
flowchart TD
    subgraph STOP["1. STOP all Observable subscriptions"]
        S1[SimpleRelayNode.stopSubscription]
        S2[ModularRelayNode.stopSubscription]
        S3[OperatorNode.stopSubscription]
        S4[SearchNode.stopSubscription]
    end

    subgraph FIND["2. Find active Relay nodes"]
        F1[Traverse existing graph structure backward]
        F2[Check connection to Timeline]
    end

    subgraph START["3. START active relay subscriptions"]
        ST1[SharedSubscriptionManager.subscribe]
    end

    subgraph WIRE["4-12. Wire Observable streams in order"]
        W1[4. Operator: setInputs]
        W2[5. Search: setInput]
        W3[6. Language: setInput]
        W4[7. NostrFilter: setInput]
        W5[8. Count: setInput]
        W6[9. Extraction: setInput]
        W7[10. If: setInputA, setInputB]
        W8[11. ModularRelay: sockets → relay → trigger]
        W9[12. Timeline: setInput, setOnTimelineSignal]
    end

    STOP --> FIND --> START --> WIRE
    W1 --> W2 --> W3 --> W4 --> W5 --> W6 --> W7 --> W8 --> W9
```

### Node Input Wiring Pattern

Each processing node follows this pattern:

```typescript
setInput(input$: Observable<Signal> | null): void {
  this.input$ = input$;
  this.rebuildPipeline();
}

private rebuildPipeline(): void {
  // 1. Stop existing subscription
  this.stopSubscription();

  // 2. Early return if no input
  if (!this.input$) return;

  // 3. Create new subscription with processing
  this.subscription = this.input$.pipe(
    filter(...),  // or other operators
  ).subscribe({
    next: (signal) => this.outputSubject.next(transformedSignal)
  });
}
```

## 2. Subscription Lifecycle

### State Machine: Relay Subscription

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> sub_stored: connect
    sub_stored --> sub_realtime: EOSE
    sub_stored --> closed: error / close
    sub_realtime --> closed: error / close
    closed --> idle: rebuildPipeline()

    note right of sub_stored: Receiving stored events
    note right of sub_realtime: Receiving real-time events
```

### When Subscriptions Start

| Trigger | Location | Description |
|---------|----------|-------------|
| App load | `GraphEditor.tsx` `useEffect` | Load graph from localStorage/Nostr, then `rebuildPipeline()` |
| Add connection | `GraphEditor.tsx` `handleConnectionCreated` | Save graph, then `rebuildPipeline()` |
| Remove connection | `GraphEditor.tsx` `handleConnectionRemoved` | Save graph, then `rebuildPipeline()` |
| Control change | `GraphEditor.tsx` `handleControlChange` | Save graph, clear downstream timelines, then `rebuildPipeline()` |
| ModularRelay trigger | `ModularRelayNode.ts` `tryStartSubscription` | When trigger input becomes true |

### When Subscriptions Stop

| Trigger | Location | Description |
|---------|----------|-------------|
| Before rebuild | `rebuildPipeline()` | All nodes' `stopSubscription()` called first |
| Node deleted | `handleDelete()` | Node removed, triggers rebuild |
| Connection removed | `handleConnectionRemoved()` | Relay may become inactive |
| ModularRelay trigger=false | `ModularRelayNode.ts` | Stop when trigger becomes false |

## 3. Event Emission Flow

### Signal Types

| Socket Type | Signal Format | Source |
|-------------|---------------|--------|
| Event | `{ event: NostrEvent, signal: 'add' \| 'remove' }` | SimpleRelayNode, ModularRelayNode |
| EventId | `{ eventId: string, signal: 'add' \| 'remove' }` | ExtractionNode |
| Pubkey | `{ pubkey: string, signal: 'add' \| 'remove' }` | ExtractionNode, Nip07Node |
| Relay | `{ relay: string, signal: 'add' \| 'remove' }` | ExtractionNode, ConstantNode |
| Integer | `{ type: 'integer', value: number }` | CountNode, ConstantNode |
| Datetime | `{ type: 'datetime', value: number }` | ExtractionNode, ConstantNode |
| Flag | `{ flag: boolean }` | IfNode, ConstantNode |
| RelayStatus | `{ relay: string, status: RelayStatusType }` | ModularRelayNode |
| Trigger | `{ trigger: boolean }` | ConstantNode, IfNode |

### Event Flow Example

```mermaid
flowchart TD
    A[SimpleRelayNode] -->|EventSignal| B[OperatorNode AND]
    B -->|EventSignal filtered| C[SearchNode]
    C -->|EventSignal filtered| D[TimelineNode]
    D -->|TimelineSignal| E[GraphEditor callback]
    E -->|convertToTimelineItem| F[TimelineItem component]
    F -->|Profile fetch| G[ProfileFetcher]
    F -->|Reaction fetch| H[ReactionFetcher]
    F --> I[UI Render]
```

### Operator Node Processing

| Operator | Behavior |
|----------|----------|
| OR | `merge(input1$, input2$)` - pass through both streams |
| AND | Emit only when event ID seen from both inputs |
| A-B | Pass input1 as-is; invert input2 signals (add↔remove) |

### Extraction Node Processing

```mermaid
flowchart TD
    A[Input: EventSignal] --> B{extractionField}
    B -->|eventId| C["emit { eventId: event.id, signal }"]
    B -->|author| D["emit { pubkey: event.pubkey, signal }"]
    B -->|createdAt| E["emit { datetime: event.created_at, signal }"]
    B -->|#e| F["for each #e tag: emit { eventId, signal }"]
    B -->|#p| G["for each #p tag: emit { pubkey, signal }"]
    B -->|#r| H["for each #r tag: emit { relay, signal }"]
```

## 4. User Editing Triggers

### State Machine: Control Change

```mermaid
flowchart TD
    A[User edits control] -->|blur/change| B[Control dispatches event]
    B --> C[GraphEditor.handleControlChange]
    C --> D[saveCurrentGraph to localStorage]
    D --> E{rebuildPipeline needed?}
    E -->|No| F[Done]
    E -->|Yes| G[Find downstream Timelines via DFS]
    G --> H[Clear only downstream timelines]
    H --> I[rebuildPipeline]
    I --> F
```

### Control Types and Rebuild Behavior

| Control Type | Triggers Rebuild | Example |
|--------------|------------------|---------|
| TextInputControl | Yes (default) | Relay URL, Search keyword |
| TextInputControl | No (if flag set) | Timeline name |
| SelectControl | Yes | Operator type, Extraction field |
| CheckboxControl | Yes | Exclude checkbox |
| FilterControl | Yes | Relay filters |

### Downstream Timeline Detection

```mermaid
flowchart TD
    A[Changed Node] --> B[DFS traversal]
    B --> C{Node type?}
    C -->|TimelineNode| D[Add to clear list]
    C -->|Other| E[Continue DFS via outputs]
    E --> B
    D --> F[Clear only affected timelines]
```

## 5. SharedSubscriptionManager

### Purpose

Multiple SimpleRelayNodes can share one WebSocket connection per relay.

### State Machine: Relay Connection

```mermaid
stateDiagram-v2
    [*] --> NoSubs: init
    NoSubs --> HasSubs: subscribe(nodeId, filters)
    HasSubs --> HasSubs: subscribe another
    HasSubs --> NoSubs: last unsubscribe
    HasSubs --> ApplyFilters: filters change
    ApplyFilters --> HasSubs: debounce 100ms

    note right of ApplyFilters: Combine all subscriber filters\nEmit to rx-nostr
```

### Filter Combination

```typescript
// Multiple subscribers with different filters
Subscriber A: { kinds: [1], authors: [alice] }
Subscriber B: { kinds: [1], authors: [bob] }

// Combined filter sent to relay
Combined: { kinds: [1], authors: [alice, bob] }

// Event routing
Event from alice → broadcast to Subscriber A only
Event from bob   → broadcast to Subscriber B only
```

## 6. ModularRelayNode Startup Sequence

### State Machine: ModularRelay Subscription

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> waiting_sockets: setSocketInput() called
    waiting_sockets --> waiting_sockets: receiving socket values
    waiting_sockets --> waiting_relay: all socket values received
    waiting_relay --> waiting_sockets: missing value
    waiting_relay --> waiting_trigger: relay URLs received
    waiting_trigger --> waiting_relay: relay empty
    waiting_trigger --> subscribed: trigger = true
    subscribed --> waiting_trigger: trigger = false

    note right of waiting_sockets: Collecting filter values
    note right of waiting_relay: Waiting for relay URLs
    note right of waiting_trigger: Ready, waiting for trigger
    note right of subscribed: Active subscription
```

### tryStartSubscription() Conditions

All conditions must be true:
1. `triggerState === true` (or no trigger input connected)
2. `relayUrls.length > 0`
3. `areRequiredInputsConnected()` - all required sockets wired
4. `areAllSocketValuesReceived()` - all socket values received
5. `!isSubscribed()` - not already subscribed

## 7. Timeline Item Processing

### State Machine: Timeline Item

```mermaid
flowchart TD
    A[Signal arrives] --> B{signal type?}

    B -->|add| C{in excluded set?}
    C -->|Yes| D[Remove from excluded, skip]
    C -->|No| E{already exists?}
    E -->|Yes| F[Skip - dedupe]
    E -->|No| G[Add to list]

    B -->|remove| H{item exists?}
    H -->|Yes| I[Remove from list]
    H -->|No| J[Add to excluded set]

    G --> K[Sort by time for events]
    K --> L["slice(0, 100) limit"]
    L --> M[Update UI]

    I --> M
    D --> N[Done]
    F --> N
    J --> N
```

## 8. Background Fetchers

### ProfileFetcher

```mermaid
sequenceDiagram
    participant TN as TimelineNode
    participant PF as ProfileFetcher
    participant R as Relay
    participant TI as TimelineItem

    TN->>PF: queueRequest(pubkey)
    Note over PF: Batch queue
    PF->>PF: Wait 1000ms or 50 items
    PF->>R: backward subscription {kinds:[0], authors:[...]}
    R-->>PF: Profile events
    PF->>PF: saveProfileToCache()
    PF->>TI: notify callbacks
    TI->>TI: Re-render with profile
```

### ReactionFetcher

```mermaid
sequenceDiagram
    participant TI as TimelineItem
    participant RF as ReactionFetcher
    participant R as Relay

    TI->>RF: queueRequest(eventId)
    Note over RF: Batch queue
    RF->>RF: Wait 1000ms or 50 items
    RF->>R: backward subscription {kinds:[6,7], #e:[...]}
    R-->>RF: Reaction/Repost events
    RF->>RF: addToCache()
    RF->>TI: notify callbacks
    TI->>TI: Update reaction count
```

## Source Files

| Component | File | Key Functions |
|-----------|------|---------------|
| GraphEditor | `src/components/Graph/GraphEditor.tsx` | `rebuildPipeline()`, `handleControlChange()` |
| SimpleRelayNode | `src/components/Graph/nodes/SimpleRelayNode.ts` | `startSubscription()`, `stopSubscription()` |
| ModularRelayNode | `src/components/Graph/nodes/ModularRelayNode.ts` | `tryStartSubscription()`, `setTriggerInput()` |
| OperatorNode | `src/components/Graph/nodes/OperatorNode.ts` | `setInputs()`, `rebuildPipeline()` |
| SearchNode | `src/components/Graph/nodes/SearchNode.ts` | `setInput()`, `rebuildPipeline()` |
| TimelineNode | `src/components/Graph/nodes/TimelineNode.ts` | `setInput()`, `setOnTimelineSignal()` |
| ExtractionNode | `src/components/Graph/nodes/ExtractionNode.ts` | `setInput()`, `extractAndEmit()` |
| SharedSubscriptionManager | `src/nostr/SharedSubscriptionManager.ts` | `subscribe()`, `applyFilters()` |
| ProfileFetcher | `src/nostr/ProfileFetcher.ts` | `queueRequest()`, `flushBatch()` |
| ReactionFetcher | `src/nostr/ReactionFetcher.ts` | `queueRequest()`, `flushBatch()` |
