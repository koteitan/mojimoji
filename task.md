# purpose
- the terminals treet only events before.
- the new project is to make the terminals treet the data of the classes as follows:

# specifications
- class
  - event id
  - pubkey
  - relay
  - flag (0 or 1)
  - integer
  - datetime
  - relay status {idle, connecting, sub-stored, EOSE, sub-realtime, closed, error}
- notes:
  - there is two representations beck32 and hex for event id, pubkey. Their instances shall be treated the same.

- new nodes
  - add the following nodes.
  - multi type relay node:
    - input terminals:
      - trigger
      - relay
      - kind (kind in attribute): type: integer
      - limit (limit in attribute): type: integer
      - since (since in attribute): type: datetime
      - until (until in attribute): type: datetime
      - ids (ids in attribute): type: event id
      - authors (authors in attribute): type: pubkey
      - #e (#e in attribute): type: event id
      - #p (#p in attribute): type: pubkey
    - output terminals: event
    - attributes: same as relay node
    - behavior:
      - when the input is 1 on trigger, subscribe to the specified relay with the merged filter of the input terminals and the attribute values.
      


  - extraction node:
    - note: this node extracts the specified attribute from the input event.
    - input terminals: event
    - output terminals:
      - event id (event id, #e is selected in attribute)
      - pubkey (author, #p is selected in attribute)
      - datetime (created_at is selected in attribute)
      - relay (#r is selected in attribute)
    - attributes:
      - select: event id / pubkey / created_at / #e / #p / #r 
      - relay type: dropdown
        - all
        - with read
        - with write
        - with read and write
  - NIP-07 node
    - output: pubkey in NIP-07
  - constant node
    - output: constant value
    - attributes:
      - select: integer / datetime / event id / pubkey / relay / flag / relay status
      - value:
        - text input for event id / pubkey
        - text area for relay 
        - dropdown for relay status (idle, connecting, sub-stored, EOSE, sub-realtime, closed, error)
  - if node
    - input terminals:
      - A type: integer, datetime
      - B type: integer, datetime (same as A)
    - attributes:
      - select:
        - equal
        - not equal
        - greater than
        - less than
        - greater than or equal
        - less than or equal
    - behavior:
      - the default output when there is no connection or there is no value input is false (0).
      - when the input data is updated on either A or B, the output shall calculated with the latest values of A and B.
  - count node
    - input terminals: input
    - output terminals: integer
    - behavior:
      - counts the number of input data received.

- updated nodes:
  - update the following nodes to use the new socket types.
  - operation node:
    - class of the A, B, and output terminals shall be same.
  - timeline node:
    - show other types as follows:
      - event:
        - kind 0: show as profile summary (pubkey, name, about, picture)
        - kind 1: same as previous version (icon, name, display_name, content, datetime)
        - kind others: show as event id string (beck32 or hex)
      - event id: beck32
      - pubkey: icon, name, display_name
      - datetime: show as ISO 8601 string
      - relay: show as URL string. split by <br>
      - integer, flag, relay status: show as string

# Implementation Checklist
## examples
-- [x] finished item
-- [ ] unfinished item

## tasks

### 1. Add new socket types (src/components/Graph/nodes/types.ts)
- [x] Add EventIdSocket class
- [x] Add PubkeySocket class
- [x] Add RelaySocket class
- [x] Add FlagSocket class
- [x] Add IntegerSocket class
- [x] Add DatetimeSocket class
- [x] Add RelayStatusSocket class
- [x] Create singleton instances for each socket type
- [x] Add RelayStatus type enum: idle | connecting | sub-stored | EOSE | sub-realtime | closed | error
- [x] Add TriggerSocket class

### 2. Update CustomSocket.tsx for socket type differentiation
- [x] Add color coding for different socket types
- [x] Update socket rendering to show type visually

### 3. Implement Constant Node (src/components/Graph/nodes/ConstantNode.ts)
- [x] Create ConstantNode class
- [x] Add type selector control (integer / datetime / event id / pubkey / relay / flag / relay status)
- [x] Add value input control (text for event id/pubkey, textarea for relay, dropdown for relay status)
- [x] Add appropriate output socket based on selected type
- [x] Implement serialize/deserialize
- [x] Export constant value based on selected type

### 4. Implement NIP-07 Node (src/components/Graph/nodes/Nip07Node.ts)
- [x] Create Nip07Node class
- [x] Add pubkey output socket
- [x] Integrate with existing src/nostr/nip07.ts (getPubkey)
- [x] Handle NIP-07 unavailable case
- [x] Implement serialize/deserialize

### 5. Implement Extraction Node (src/components/Graph/nodes/ExtractionNode.ts)
- [x] Create ExtractionNode class
- [x] Add event input socket
- [x] Add selector control (event id / pubkey / created_at / #e / #p / #r)
- [x] Add relay type filter dropdown (all / with read / with write / with read and write)
- [x] Add appropriate output socket based on selected extraction type
- [x] Implement extraction logic for each field type
- [x] Implement serialize/deserialize

### 6. Implement Multi Type Relay Node (src/components/Graph/nodes/MultiTypeRelayNode.ts)
- [x] Create MultiTypeRelayNode class extending or refactoring RelayNode
- [x] Add dynamic input sockets (user selects which inputs to enable)
- [x] Add trigger input socket
- [x] Add relay input socket (type: relay)
- [x] Add kind input socket (type: integer)
- [x] Add limit input socket (type: integer)
- [x] Add since input socket (type: datetime)
- [x] Add until input socket (type: datetime)
- [x] Add ids input socket (type: event id)
- [x] Add authors input socket (type: pubkey)
- [x] Add #e input socket (type: event id)
- [x] Add #p input socket (type: pubkey)
- [x] Add event output socket
- [x] Merge input socket values with attribute values
- [x] Reuse existing RelayNode logic for subscription management
- [x] Implement serialize/deserialize

### 7. Implement If Node (src/components/Graph/nodes/IfNode.ts)
- [x] Create IfNode class
- [x] Add A input socket (type: integer | datetime)
- [x] Add B input socket (type: integer | datetime, same as A)
- [x] Add comparison selector control (equal / not equal / greater than / less than / >= / <=)
- [x] Add flag output socket
- [x] Implement comparison logic
- [x] Implement serialize/deserialize

### 8. Update Operation Node (src/components/Graph/nodes/OperatorNode.ts)
- [x] Update to support all socket types (not just Event)
- [x] Ensure A, B, and output terminals have the same class
- [x] Add type selector or auto-detect type from connections
- [x] Implement AND/OR/A-B logic for each data type

### 9. Update Timeline Node (src/components/Graph/nodes/TimelineNode.ts, src/components/Timeline/)
- [x] Update input socket to accept all types (not just Event)
- [x] Implement type-specific rendering:
  - [x] event kind 0: show as profile summary (pubkey, name, about, picture)
  - [x] event kind 1: same as previous (icon, name, display_name, content, datetime)
  - [x] event kind others: show as event id string (bech32 or hex)
  - [x] event id: show as bech32
  - [x] pubkey: show icon, name, display_name
  - [x] datetime: show as ISO 8601 string
  - [x] relay: show as URL string, split by <br>
  - [x] integer, flag, relay status: show as string

### 10. Register new nodes in node index (src/components/Graph/nodes/index.ts)
- [x] Export ConstantNode
- [x] Export Nip07Node
- [x] Export ExtractionNode
- [x] Export MultiTypeRelayNode
- [x] Export IfNode

### 11. Update GraphEditor.tsx
- [x] Add new nodes to node factory
- [x] Add new nodes to toolbar
- [x] Add socket compatibility validation (prevent connecting incompatible types)
- [x] Handle new socket type connections

### 12. Update graph serialization/deserialization
- [x] Update save format in src/nostr/graphStorage.ts if needed
- [x] Handle new node types in load/save

### 13. Add i18n translations
- [x] Add node titles and control labels in English (src/i18n/locales/en.json)
- [x] Add node titles and control labels in Japanese (src/i18n/locales/ja.json)

### 14. Update specifications (spec.md, save.md, save-ja.md)
- [x] Document new socket types
- [x] Document new nodes
- [ ] Update save format documentation if needed

### 15. Testing
- [ ] Test each new node individually
- [ ] Test socket type compatibility
- [ ] Test graph save/load with new nodes
- [ ] Test node connections between new and existing nodes
