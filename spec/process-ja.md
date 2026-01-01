# イベント処理とサブスクリプションフロー

このドキュメントでは、サブスクリプション、ノードチェーン、イベント発行、ユーザー編集がいつ・どのように処理されるかを説明します。

## 概要

```mermaid
flowchart LR
    A[ユーザー操作] --> B[コントロール変更]
    B --> C[グラフ保存]
    C --> D[パイプライン再構築]
    D --> E[サブスクリプション開始]
    E --> F[イベント流通]
    F --> G[タイムライン更新]
```

## 1. パイプライン再構築プロセス

### 前提: グラフ構造とObservable接続

- **グラフ構造（Edge/Connection）**: rete.jsエディタ上の接続線。ユーザーが編集済みで既に存在する。
- **Observable接続（setInput）**: RxJSのsubscribe。rebuildPipeline()で設定する。

ステップ2の「探索」は既存のグラフ構造を参照し、ステップ4-12でObservableを設定します。

### 実行順序

```mermaid
flowchart TD
    subgraph STOP["1. 全Observableサブスクリプション停止"]
        S1[SimpleRelayNode.stopSubscription]
        S2[ModularRelayNode.stopSubscription]
        S3[OperatorNode.stopSubscription]
        S4[SearchNode.stopSubscription]
    end

    subgraph FIND["2. アクティブなリレーノード検索"]
        F1[既存のグラフ構造を逆方向に探索]
        F2[Timelineへの接続を確認]
    end

    subgraph START["3. アクティブなリレーのサブスクリプション開始"]
        ST1[SharedSubscriptionManager.subscribe]
    end

    subgraph WIRE["4-12. Observableストリームを順番に接続"]
        W1[4. Operator: setInputs]
        W2[5. Search: setInput]
        W3[6. Language: setInput]
        W4[7. NostrFilter: setInput]
        W5[8. Count: setInput]
        W6[9. Extraction: setInput]
        W7[10. If: setInputA, setInputB]
        W8[11. ModularRelay: ソケット → リレー → トリガー]
        W9[12. Timeline: setInput, setOnTimelineSignal]
    end

    STOP --> FIND --> START --> WIRE
    W1 --> W2 --> W3 --> W4 --> W5 --> W6 --> W7 --> W8 --> W9
```

### ノード入力接続パターン

各処理ノードは以下のパターンに従います：

```typescript
setInput(input$: Observable<Signal> | null): void {
  this.input$ = input$;
  this.rebuildPipeline();
}

private rebuildPipeline(): void {
  // 1. 既存のサブスクリプションを停止
  this.stopSubscription();

  // 2. 入力がなければ早期リターン
  if (!this.input$) return;

  // 3. 処理を含む新しいサブスクリプションを作成
  this.subscription = this.input$.pipe(
    filter(...),  // またはその他のオペレータ
  ).subscribe({
    next: (signal) => this.outputSubject.next(transformedSignal)
  });
}
```

## 2. サブスクリプションのライフサイクル

### 状態マシン: リレーサブスクリプション

```mermaid
stateDiagram-v2
    [*] --> idle: 初期状態
    idle --> sub_stored: 接続
    sub_stored --> sub_realtime: EOSE受信
    sub_stored --> closed: エラー / 切断
    sub_realtime --> closed: エラー / 切断
    closed --> idle: rebuildPipeline()

    note right of sub_stored: 保存済みイベント受信中
    note right of sub_realtime: リアルタイムイベント受信中
```

### サブスクリプション開始タイミング

| トリガー | 場所 | 説明 |
|---------|------|------|
| アプリ起動 | `GraphEditor.tsx` `useEffect` | localStorage/Nostrからグラフ読込後、`rebuildPipeline()` |
| 接続追加 | `GraphEditor.tsx` `handleConnectionCreated` | グラフ保存後、`rebuildPipeline()` |
| 接続削除 | `GraphEditor.tsx` `handleConnectionRemoved` | グラフ保存後、`rebuildPipeline()` |
| コントロール変更 | `GraphEditor.tsx` `handleControlChange` | グラフ保存、下流タイムラインクリア後、`rebuildPipeline()` |
| ModularRelayトリガー | `ModularRelayNode.ts` `tryStartSubscription` | トリガー入力がtrueになった時 |

### サブスクリプション停止タイミング

| トリガー | 場所 | 説明 |
|---------|------|------|
| 再構築前 | `rebuildPipeline()` | 全ノードの`stopSubscription()`を最初に呼出 |
| ノード削除 | `handleDelete()` | ノード削除により再構築発生 |
| 接続削除 | `handleConnectionRemoved()` | リレーが非アクティブになる場合 |
| ModularRelayトリガー=false | `ModularRelayNode.ts` | トリガーがfalseになった時に停止 |

## 3. イベント発行フロー

### シグナル型

| ソケット型 | シグナル形式 | 発生元 |
|-----------|-------------|--------|
| Event | `{ event: NostrEvent, signal: 'add' \| 'remove' }` | SimpleRelayNode, ModularRelayNode |
| EventId | `{ eventId: string, signal: 'add' \| 'remove' }` | ExtractionNode |
| Pubkey | `{ pubkey: string, signal: 'add' \| 'remove' }` | ExtractionNode, Nip07Node |
| Relay | `{ relay: string, signal: 'add' \| 'remove' }` | ExtractionNode, ConstantNode |
| Integer | `{ type: 'integer', value: number }` | CountNode, ConstantNode |
| Datetime | `{ type: 'datetime', value: number }` | ExtractionNode, ConstantNode |
| Flag | `{ flag: boolean }` | IfNode, ConstantNode |
| RelayStatus | `{ relay: string, status: RelayStatusType }` | ModularRelayNode |
| Trigger | `{ trigger: boolean }` | ConstantNode, IfNode |

### イベントフロー例

```mermaid
flowchart TD
    A[SimpleRelayNode] -->|EventSignal| B[OperatorNode AND]
    B -->|フィルタ済みEventSignal| C[SearchNode]
    C -->|フィルタ済みEventSignal| D[TimelineNode]
    D -->|TimelineSignal| E[GraphEditorコールバック]
    E -->|convertToTimelineItem| F[TimelineItemコンポーネント]
    F -->|プロフィール取得| G[ProfileFetcher]
    F -->|リアクション取得| H[ReactionFetcher]
    F --> I[UI描画]
```

### Operatorノードの処理

| オペレータ | 動作 |
|-----------|------|
| OR | `merge(input1$, input2$)` - 両方のストリームをそのまま通過 |
| AND | イベントIDが両方の入力で確認された場合のみ発行 |
| A-B | input1はそのまま通過、input2のシグナルを反転（add↔remove） |

### Extractionノードの処理

```mermaid
flowchart TD
    A[入力: EventSignal] --> B{extractionField}
    B -->|eventId| C["{ eventId: event.id, signal } を発行"]
    B -->|author| D["{ pubkey: event.pubkey, signal } を発行"]
    B -->|createdAt| E["{ datetime: event.created_at, signal } を発行"]
    B -->|#e| F["各#eタグに対して { eventId, signal } を発行"]
    B -->|#p| G["各#pタグに対して { pubkey, signal } を発行"]
    B -->|#r| H["各#rタグに対して { relay, signal } を発行"]
```

## 4. ユーザー編集トリガー

### 状態マシン: コントロール変更

```mermaid
flowchart TD
    A[ユーザーがコントロールを編集] -->|blur/change| B[コントロールがイベントを発行]
    B --> C[GraphEditor.handleControlChange]
    C --> D[saveCurrentGraphでlocalStorageに保存]
    D --> E{rebuildPipelineが必要?}
    E -->|No| F[完了]
    E -->|Yes| G[DFSで下流Timelineを検索]
    G --> H[下流タイムラインのみクリア]
    H --> I[rebuildPipeline]
    I --> F
```

### コントロール型と再構築動作

| コントロール型 | 再構築を発火 | 例 |
|---------------|-------------|-----|
| TextInputControl | Yes（デフォルト） | リレーURL、検索キーワード |
| TextInputControl | No（フラグ設定時） | タイムライン名 |
| SelectControl | Yes | オペレータ型、抽出フィールド |
| CheckboxControl | Yes | 除外チェックボックス |
| FilterControl | Yes | リレーフィルタ |

### 下流タイムライン検出

```mermaid
flowchart TD
    A[変更されたノード] --> B[DFS探索]
    B --> C{ノード型?}
    C -->|TimelineNode| D[クリアリストに追加]
    C -->|その他| E[出力経由でDFS継続]
    E --> B
    D --> F[影響を受けるタイムラインのみクリア]
```

## 5. SharedSubscriptionManager

### 目的

複数のSimpleRelayNodeが1つのリレーに対して1つのWebSocket接続を共有できます。

### 状態マシン: リレー接続

```mermaid
stateDiagram-v2
    [*] --> NoSubs: 初期化
    NoSubs --> HasSubs: subscribe(nodeId, filters)
    HasSubs --> HasSubs: 別のsubscribe
    HasSubs --> NoSubs: 最後のunsubscribe
    HasSubs --> ApplyFilters: フィルタ変更
    ApplyFilters --> HasSubs: デバウンス100ms

    note right of ApplyFilters: 全サブスクライバのフィルタを結合\nrx-nostrに送信
```

### フィルタ結合

```typescript
// 異なるフィルタを持つ複数のサブスクライバ
サブスクライバA: { kinds: [1], authors: [alice] }
サブスクライバB: { kinds: [1], authors: [bob] }

// リレーに送信される結合フィルタ
結合: { kinds: [1], authors: [alice, bob] }

// イベントルーティング
aliceからのイベント → サブスクライバAのみにブロードキャスト
bobからのイベント   → サブスクライバBのみにブロードキャスト
```

## 6. ModularRelayNodeの起動シーケンス

### 状態マシン: ModularRelayサブスクリプション

```mermaid
stateDiagram-v2
    [*] --> idle: 初期状態
    idle --> waiting_inputs: setSocketInput()/setRelayInput()
    waiting_inputs --> waiting_inputs: 値受信中
    waiting_inputs --> subscribed: 全入力complete AND リレー有
    waiting_inputs --> subscribed: 外部トリガー=true AND リレー有
    subscribed --> idle: トリガー=false (外部トリガー使用時)

    note right of waiting_inputs: 値とcomplete信号を収集中
    note right of subscribed: アクティブなサブスクリプション
```

### tryStartSubscription()の条件

サブスクリプション開始条件：
```
(triggerState OR areAllSocketsCompleted()) AND relayUrls.length > 0 AND areRequiredInputsConnected() AND !isSubscribed()
```

条件の詳細：
| 条件 | 説明 |
|------|------|
| `triggerState` | 外部トリガーがtrue（または未接続時はデフォルトtrue） |
| `areAllSocketsCompleted()` | 全ソケット入力がcomplete信号を受信済み |
| `relayUrls.length > 0` | リレーURLを1つ以上受信済み |
| `areRequiredInputsConnected()` | 必要な全ソケットが接続済み |
| `!isSubscribed()` | まだサブスクライブしていない |

**動作:**
- 外部トリガーを使用する場合：トリガーがtrueになったら即座にサブスクリプション開始（ソケット完了を待たない）
- 外部トリガーを使用しない場合：全ソケット入力がcompleteしたらサブスクリプション開始

### RxJS complete信号の伝播

ConstantNodeとNip07Nodeは値を発行後、`complete()`を呼び出します。これにより下流ノードはすべての初期値が送信されたことを知ることができます。

```mermaid
flowchart LR
    C[ConstantNode] -->|"value + complete"| M[ModularRelay]
    N[Nip07Node] -->|"pubkey + complete"| M
    M -->|"全complete受信"| S[startSubscription]
```

中間ノード（IfNode、ExtractionNode等）は、全入力がcompleteした時に出力をcompleteします。

## 7. タイムラインアイテム処理

### 状態マシン: タイムラインアイテム

```mermaid
flowchart TD
    A[シグナル到着] --> B{シグナル型?}

    B -->|add| C{除外セットに存在?}
    C -->|Yes| D[除外セットから削除、スキップ]
    C -->|No| E{既に存在?}
    E -->|Yes| F[スキップ - 重複排除]
    E -->|No| G[リストに追加]

    B -->|remove| H{アイテムが存在?}
    H -->|Yes| I[リストから削除]
    H -->|No| J[除外セットに追加]

    G --> K[イベントの場合は時間順にソート]
    K --> L["slice(0, 100)で制限"]
    L --> M[UI更新]

    I --> M
    D --> N[完了]
    F --> N
    J --> N
```

## 8. バックグラウンドフェッチャー

### ProfileFetcher

```mermaid
sequenceDiagram
    participant TN as TimelineNode
    participant PF as ProfileFetcher
    participant R as リレー
    participant TI as TimelineItem

    TN->>PF: queueRequest(pubkey)
    Note over PF: バッチキュー
    PF->>PF: 1000msまたは50件まで待機
    PF->>R: backwardサブスクリプション {kinds:[0], authors:[...]}
    R-->>PF: プロフィールイベント
    PF->>PF: saveProfileToCache()
    PF->>TI: コールバック通知
    TI->>TI: プロフィールで再描画
```

### ReactionFetcher

```mermaid
sequenceDiagram
    participant TI as TimelineItem
    participant RF as ReactionFetcher
    participant R as リレー

    TI->>RF: queueRequest(eventId)
    Note over RF: バッチキュー
    RF->>RF: 1000msまたは50件まで待機
    RF->>R: backwardサブスクリプション {kinds:[6,7], #e:[...]}
    R-->>RF: リアクション/リポストイベント
    RF->>RF: addToCache()
    RF->>TI: コールバック通知
    TI->>TI: リアクション数を更新
```

## ソースファイル

| コンポーネント | ファイル | 主要関数 |
|--------------|---------|----------|
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
