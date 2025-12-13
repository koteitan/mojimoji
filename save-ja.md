# グラフ保存仕様

## 保存先
- 自動保存
  - LocalStorage
- 手動保存
  - LocalStorage へ
  - Nostr リレーへ
    - public（誰でも検索・読込可能）
    - for yourself（自分の npub でフィルタ、暗号化なし）
  - ファイルへ

## 保存フォーマット

### json フォーマット

#### Nostr リレー内（NIP-78 イベント）
```json
// Public
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"],
    ["public"]
  ],
  "content": "[graph data を JSON 文字列化したもの]",
  "sig": "[signature]"
}

// For yourself（public タグなし）
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"]
  ],
  "content": "[graph data を JSON 文字列化したもの]",
  "sig": "[signature]"
}
```
- Public: `["public"]` タグあり、`#public` フィルタで誰でも検索可能
- For yourself: `public` タグなし、検索には自分の pubkey を指定した `authors` フィルタが必要

#### LocalStorage 内
mojimoji が使用する localStorage キー:
- `mojimoji-graph`: 自動保存されたグラフデータ（現在作業中のグラフ）
- `mojimoji-profile-cache`: キャッシュされたユーザープロフィール（kind:0 イベント）

手動保存用に追加予定:
- `mojimoji-saved-graphs`: 保存されたグラフの配列

```json
// mojimoji-graph（自動保存、単一グラフ）
[graph data]

// mojimoji-profile-cache（プロフィールキャッシュ）
{
  "[pubkey]": {
    "name": "string",
    "display_name": "string",
    "picture": "url",
    "about": "string",
    "nip05": "string"
  },
  ...
}

// mojimoji-saved-graphs（手動保存、グラフの配列）
[
  {
    "path": "[graph path]",
    "data": [graph data],
    "savedAt": [unix-timestamp]
  },
  ...
]
```

#### ファイル内
```json
{
  "path": "[graph path]",
  "data": [graph data]
}
```

### graph path（グラフパス）
- 形式: `[グラフディレクトリ]/[グラフ名]`
- グラフディレクトリ: `[dir]/[subdir]/[subdir]/.../[subdir]`
- グラフ名: `[name]`
- 備考: NIP-116（ドラフト）はパスベースのイベント用に kind 30079 を提案しており、`d` タグにフルパス、`f` タグにディレクトリを格納するが、まだマージされていない。現時点では NIP-78（kind 30078）を使用し、`d` タグに独自のパス規約を使用する。

### graph data（グラフデータ）
```json
{
  "nodes": [
    {
      "id": "[node-id]",
      "type": "Relay" | "Operator" | "Search" | "Language" | "NostrFilter" | "Timeline",
      "position": { "x": number, "y": number },
      "data": { ... }
    },
    ...
  ],
  "connections": [
    {
      "id": "[connection-id]",
      "source": "[source-node-id]",
      "sourceOutput": "[output-socket-key]",
      "target": "[target-node-id]",
      "targetInput": "[input-socket-key]"
    },
    ...
  ],
  "viewTransform": {
    "x": number,
    "y": number,
    "k": number
  }
}
```
- ノードタイプ別のデータ形式:
  - Relay: `{ relayUrls: string[], filters: Filters }`
  - Operator: `{ operation: "and" | "or" | "a-b" }`
  - Search: `{ searchText: string, exclude: boolean }`
  - Language: `{ language: string }`
  - NostrFilter: `{ filterElements: FilterElement[], exclude: boolean }`
  - Timeline: `{ timelineName: string }`
- viewTransform: グラフエディタのビュー位置（パンとズーム）
  - x, y: パンオフセット（ピクセル単位）
  - k: ズーム倍率（1.0 = 100%）

### （参考）現在の LocalStorage 自動保存フォーマット
- localStorage キー: `mojimoji-graph`
- 形式: [graph data](#graph-dataグラフデータ) と同じ

## 保存 UI 仕様

### 画面遷移
- グラフエディタ画面（メイン）
  - 「Save」ボタンクリック -> 保存ダイアログ
  - 「Load」ボタンクリック -> 読込ダイアログ
  - Ctrl+S -> 保存ダイアログ
  - Ctrl+O -> 読込ダイアログ
- 保存ダイアログ
  - 「Save」クリック -> 保存して閉じる -> グラフエディタ画面
  - 「Cancel」クリック / Escape キー -> グラフエディタ画面
- 読込ダイアログ
  - グラフを選択し「Load」クリック -> 読み込んで閉じる -> グラフエディタ画面
  - 「Cancel」クリック / Escape キー -> グラフエディタ画面

### 画面配置
- グラフエディタ画面（既存、ツールバーにボタン追加）
  - 上部: ツールバー
    - 既存のボタン...
    - [Save] ボタン（新規）
    - [Load] ボタン（新規）
  - 中央: グラフエディタキャンバス
  - 右下: バージョン情報 + GitHub リンク

- 保存ダイアログ（モーダルオーバーレイ）
  - 上部: タイトル「Save Graph」
  - 中央:
    - 保存先タブ: [LocalStorage] [Nostr Relay] [File]
    - 現在のパス: パンくずナビ（クリック可能: root > dir > subdir）
    - ディレクトリブラウザ:
      - [..] （親ディレクトリ、ルート以外）
      - サブディレクトリ（クリックで移動）
      - 現在のディレクトリ内のグラフ（クリックで上書き選択）
    - 名前入力: グラフ名のテキストフィールド
    - （Nostr タブのみ）:
      - 公開設定: [Public] [For yourself] ラジオボタン
      - リレー URL: テキストエリア（省略時はグラフ内のリレーノードを使用）
  - 下部:
    - [Cancel] ボタン
    - [New Folder] ボタン
    - [Save] ボタン

- 読込ダイアログ（モーダルオーバーレイ）
  - 上部: タイトル「Load Graph」
  - 中央:
    - 読込元タブ: [LocalStorage] [Nostr Relay] [File]
    - LocalStorage タブ:
      - 現在のパス: パンくずナビ（クリック可能: root > dir > subdir）
      - ディレクトリブラウザ:
        - [..] （親ディレクトリ、ルート以外）
        - サブディレクトリ（クリックで移動）
        - 現在のディレクトリ内のグラフ（パス、保存日時）- クリックで選択
    - Nostr タブ:
      - 公開鍵入力（デフォルト: ログイン中なら自分の公開鍵）
      - 公開フィルタ: [All] [Public only] [Mine only] ラジオボタン
      - 現在のパス: パンくずナビ
      - ディレクトリブラウザ:
        - [..] （親ディレクトリ、ルート以外）
        - サブディレクトリ（クリックで移動）
        - 現在のディレクトリ内のグラフ（パス、作成日時、作者）- クリックで選択
    - File タブ:
      - [Choose File] ボタン
      - 選択されたファイル名表示
  - 下部:
    - [Cancel] ボタン
    - [Load] ボタン

## Nostr リレー保存/読込

### NIP-07 による署名
- NIP-07 ブラウザ拡張機能（nos2x、Alby など）を使用してイベントに署名
- `window.nostr.signEvent(event)` を呼び出して公開前にイベントに署名
- `window.nostr.getPublicKey()` を呼び出してユーザーの公開鍵を取得

### デフォルトリレーリスト（kind:10002）
- Nostr リレーに保存する際、デフォルトで kind:10002 イベントからユーザーのリレーリストを使用
- NIP-07 から取得したユーザーの pubkey を使用して、well-known リレーから kind:10002 イベントを取得
- イベントの `r` タグからリレーリストを解析
- ユーザーは保存ダイアログでカスタムリレー URL を指定して上書き可能

### Nostr リレーからの読込
- NIP-07 ブラウザ拡張機能から取得した pubkey をデフォルトの検索 pubkey として使用
- フィルタでリレーにクエリ: `{ kinds: [30078], authors: [pubkey], "#d": ["mojimoji/graphs/..."] }`
- 公開グラフの場合は追加で: `{ kinds: [30078], "#public": [""] }`

## NIP 参照
- NIP-07: 署名用ブラウザ拡張機能
  - https://github.com/nostr-protocol/nips/blob/master/07.md
  - 署名と pubkey アクセス用の `window.nostr` API を提供
- NIP-65: リレーリストメタデータ（kind 10002）
  - https://github.com/nostr-protocol/nips/blob/master/65.md
  - ユーザーの優先リレーリストを保存
- NIP-78: アプリケーション固有データ（kind 30078）
  - https://github.com/nostr-protocol/nips/blob/master/78.md
  - リレーに任意のアプリデータを保存するため
- NIP-116（ドラフト）: イベントパス（kind 30079）
  - https://github.com/nostr-protocol/nips/pull/1266
  - パスベースのイベント整理を提案（未マージ）
- NIP-01: 基本プロトコル
  - https://github.com/nostr-protocol/nips/blob/master/01.md
  - サブスクリプション用のフィルタ構造を定義

