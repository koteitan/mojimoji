[English version](save.md)

# グラフ保存仕様

## 保存先
- 自動保存
  - ブラウザ（localStorage）
- 手動保存
  - ブラウザ（localStorage）へ
    - グラフはブラウザの localStorage に保存
    - ブラウザのキャッシュを削除すると削除される
  - Nostr リレーへ
    - public（誰でも検索・読込可能）
    - for yourself（自分の npub でフィルタ、暗号化なし）
  - ファイルへ
    - JSON ファイルとしてコンピュータにダウンロード

## 保存フォーマット

### json フォーマット

#### Nostr リレー内（NIP-78 イベント）
```json
{
  "id": "[event-id]",
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "kind": 30078,
  "tags": [
    ["d", "mojimoji/graphs/[graph path]"],
    ["client", "mojimoji"]
  ],
  "content": "[graph data を JSON 文字列化したもの]",
  "sig": "[signature]"
}
```
備考:
- 公開設定（visibility）は graph data の content 内に保存される（API バージョン 2 以降）
- 古い（バージョン 1）イベントを読み込む場合、visibility は `["public"]` Nostr タグにフォールバックして確認される

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
  "version": 2,
  "nodes": [
    {
      "id": "[node-id]",
      "type": "Relay" | "MultiTypeRelay" | "Operator" | "Search" | "Language" | "NostrFilter" | "Timeline" | "Constant" | "Nip07" | "Extraction" | "If" | "Count",
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
  },
  "visibility": "public" | "for yourself"
}
```
- version: データ移行用の API バージョン（現在: 2）
  - バージョン 1: 初期バージョン
  - バージョン 2: visibility フィールドを graph data に追加（Nostr タグから移動）
- ノードタイプ別のデータ形式:
  - Relay: `{ relaySource?: "auto" | "manual", relayUrls: string[], filters: Filters }`
    - relaySource: オプション、後方互換性のためデフォルトは "manual"
  - MultiTypeRelay: `{ filters: Filters }`
    - filters: フィールドと値を持つフィルタ要素の配列
  - Operator: `{ operation: "and" | "or" | "a-b", dataType?: string }`
    - dataType: オプション、型付き操作用のソケットタイプ
  - Search: `{ searchText: string, exclude: boolean }`
  - Language: `{ language: string }`
  - NostrFilter: `{ filterElements: FilterElement[], exclude: boolean }`
  - Timeline: `{ timelineName: string }`
    - timelineName: タイムラインの表示名
    - 入力型は動的に検出（dataTypeフィールドなし）
  - Constant: `{ constantType: string, rawValue: string }`
    - constantType: "integer" | "datetime" | "eventId" | "pubkey" | "relay" | "flag" | "relayStatus"
    - rawValue: 値の文字列表現
  - Nip07: `{}`
    - 永続データなし（pubkey は拡張機能から取得）
  - Extraction: `{ extractionField: string, relayType?: string }`
    - extractionField: "eventId" | "author" | "createdAt" | "#e" | "#p" | "#r"
    - relayType: "all" | "read" | "write" | "readwrite"（#r フィールドのみ）
  - If: `{ comparison: string }`
    - comparison: "equal" | "notEqual" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual"
  - Count: `{}`
    - 永続データなし（カウントは実行時の状態）
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
  - 「Save」クリック -> 保存して閉じる -> グラフエディタ画面（Browser/File タブ）
  - 「Save」クリック -> 保存 -> 共有ダイアログ（Nostr Relay タブ）
  - 「Cancel」クリック / Escape キー -> グラフエディタ画面
- 共有ダイアログ（Nostr リレーへの保存後）
  - 「Copy」クリック -> パーマリンクをクリップボードにコピー
  - 「OK」クリック / Escape キー -> グラフエディタ画面
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
  - ヘッダー:
    - タイトル「Save Graph」
    - [×] 閉じるボタン
  - コンテンツ:
    - 「保存先:」ラベル
    - 保存先タブ: [Browser] [Nostr Relay] [File]
    - 保存先の説明（選択したタブに応じて変化）
    - （Browser/Nostr タブのみ）:
      - 「path:」ラベル + 現在のパス: パンくずナビ（クリック可能: root > dir > subdir）
      - ディレクトリブラウザ（最小高さ: 2行分）:
        - [..] （親ディレクトリ、ルート以外）
        - サブディレクトリ: [📁] [名前] [× 削除ボタン] （クリックで移動、削除は Browser のみ）
        - グラフ: [📄] [名前] [作者アイコン] [作者名] [保存日時] [× 削除ボタン] （クリックで上書き選択、作者情報は Nostr のみ表示）
        - Nostr リレーからの読み込み時はローディングアニメーション表示
    - 名前入力: グラフ名のテキストフィールド
    - （Nostr タブのみ）:
      - 公開設定: [For yourself] [Public] ラジオボタン（デフォルト: For yourself）
      - 公開設定の説明テキスト
      - リレー URL: テキストエリア（kind:10002 のリレーリストを自動取得して表示）
      - 「as:」ラベル + ユーザー情報表示: [アイコン] [名前]（kind:0 プロフィールから取得、"name" フィールドを使用）
    - エラーメッセージ（発生時）
  - フッター:
    - [Cancel] ボタン
    - [New Folder] ボタン（Browser/Nostr タブのみ、セッション限定フォルダを作成）
    - [Save] ボタン（プライマリ）

- 共有ダイアログ（モーダルオーバーレイ、Nostr リレーへの保存後に表示）
  - ヘッダー:
    - タイトル「Share Graph」
    - [×] 閉じるボタン
  - コンテンツ:
    - 「Permalink:」ラベル
    - 読み取り専用テキスト入力（パーマリンク URL を表示）
      - 形式: `https://koteitan.github.io/mojimoji/?e=[nevent]`
      - nevent: NIP-19 bech32 エンコードされたイベント識別子
    - 成功メッセージ: 「Graph saved successfully!」
  - フッター:
    - [Copy] ボタン - パーマリンク URL をクリップボードにコピー
    - [OK] ボタン（プライマリ）- ダイアログを閉じる

- 読込ダイアログ（モーダルオーバーレイ）
  - ヘッダー:
    - タイトル「Load Graph」
    - [×] 閉じるボタン
  - コンテンツ（注: Nostrタブのコンテンツが Browserタブより先に配置、保存ダイアログとは異なる）:
    - 「読み込み元:」ラベル
    - 読込元タブ: [Browser] [Nostr Relay] [File]（デフォルト: Browser）
    - 読込元の説明（選択したタブに応じて変化）
    - Nostr タブ:
      - リレーリスト:
        - キャプション: 「読み込み元リレー（デフォルト：kind:10002）」
        - テキストエリア: kind:10002 のリレーリストを自動取得して表示
      - フィルタ: [For yourself] [Public] [By author] ラジオボタン（デフォルト: For yourself）
        - 公開設定フィルタの動作:

          | フィルタ     | 自分の「For yourself」 | 自分の「Public」 | 他者の「For yourself」 | 他者の「Public」 |
          |--------------|------------------------|------------------|------------------------|------------------|
          | For yourself | ✔                      |                  |                        |                  |
          | Public       |                        | ✔                |                        | ✔                |
          | By author    | ✔ (自分の場合)         | ✔ (自分の場合)   | ✔                      | ✔                |

      - （By author のみ）: 作者入力（オートコンプリート付き）
        - npub、hex、または名前を入力
        - ドロップダウン候補: [アイコン] [名前]（キャッシュされた kind:0 プロフィールから）
        - display_name と name の両方を検索
    - Browser タブ:
      - 「path:」ラベル + 現在のパス: パンくずナビ（クリック可能: root > dir > subdir）
      - ディレクトリブラウザ（最小高さ: 2行分）:
        - [..] （親ディレクトリ、ルート以外）
        - サブディレクトリ: [📁] [名前] [× 削除ボタン] （クリックで移動）
        - グラフ: [📄] [名前] [作者アイコン] [作者名] [作成日時] [× 削除ボタン（自分のグラフのみ）] （クリックで選択）
        - Nostr リレーから取得中はローディングアニメーション表示
    - File タブ:
      - [Choose File] ボタン
      - 選択されたファイル名表示
    - エラーメッセージ（発生時）
  - フッター:
    - [Cancel] ボタン
    - [Copy URL] ボタン（Nostr Relay タブのみ）
      - グラフが選択されている場合のみ有効
      - パーマリンク URL をクリップボードにコピー: `https://koteitan.github.io/mojimoji/?e=[nevent]`
      - グラフ未選択時は無効
    - [Load] ボタン（プライマリ）

### ディレクトリ構造
- ディレクトリはグラフのパスから導出される（明示的なディレクトリ保存なし）
- New Folder はセッション限定フォルダを作成（ダイアログを閉じるまで表示）
- 保存されたグラフがあるフォルダは、グラフが存在する限り永続化

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
- 公開グラフの場合（バージョン 1）: `{ kinds: [30078], "#public": [""] }` でクエリ
- 公開グラフの場合（バージョン 2）: visibility は graph data 内に保存され、クライアント側でフィルタリング

## 削除

### ブラウザストレージ
- ホバー時にグラフとフォルダの削除ボタンが表示される
- グラフの削除: localStorage から即座に削除
- フォルダの削除: フォルダ内のすべてのグラフを削除（再帰的）
- 削除前に確認ダイアログを表示

### Nostr リレー（NIP-09）
- 作成者（同じ pubkey）のみが自分のイベントを削除可能
- 他のユーザーの公開グラフは削除できない（削除ボタン非表示）
- 削除リクエストのフォーマット（kind:5）:
```json
{
  "kind": 5,
  "pubkey": "[user-pubkey]",
  "created_at": [unix-timestamp],
  "tags": [
    ["a", "30078:[user-pubkey]:mojimoji/graphs/[path]"],
    ["k", "30078"]
  ],
  "content": "",
  "sig": "[signature]"
}
```
- リレーは削除リクエストのタイムスタンプまでのすべてのバージョンを削除すべき（SHOULD）
- 削除は保証されない（分散システムの制限）

### UI の動作
- ブラウザ: すべてのアイテムに削除ボタン表示（すべて自分のグラフのため）
- Nostr リレー: 自分のグラフのみ削除ボタン表示（author === user's pubkey）

## パーマリンク読込

### URL 形式
- パーマリンク形式: `https://koteitan.github.io/mojimoji/?e=[nevent]`
- nevent: NIP-19 bech32 エンコードされたイベント識別子（`nevent1...` で始まる）
- 後方互換性: hex イベント ID（64 文字の hex 文字列）もサポート

### 読込動作
- アプリ起動時に URL の `e` クエリパラメータをチェック
- パラメータが存在する場合:
  1. フィルタ `{ kinds: [30078], ids: [event-id] }` で well-known リレーからイベントを取得
  2. event.content からグラフデータをパース
  3. グラフをエディタに読み込む
  4. クエリパラメータは URL に保持（パーマリンク URL が維持される）
- イベントが見つからない、または取得に失敗した場合:
  - エラーメッセージを表示
  - localStorage またはデフォルトグラフにフォールバック

### パーマリンク読込用の Well-known リレー
- 可用性を最大化するため、人気のリレーを使用:
  - wss://relay.damus.io
  - wss://nos.lol
  - wss://relay.nostr.band
  - wss://yabu.me

## NIP 参照
- NIP-01: 基本プロトコル
  - https://github.com/nostr-protocol/nips/blob/master/01.md
  - サブスクリプション用のフィルタ構造を定義
- NIP-07: 署名用ブラウザ拡張機能
  - https://github.com/nostr-protocol/nips/blob/master/07.md
  - 署名と pubkey アクセス用の `window.nostr` API を提供
- NIP-09: イベント削除リクエスト
  - https://github.com/nostr-protocol/nips/blob/master/09.md
  - kind:5 削除リクエストイベントを定義
- NIP-65: リレーリストメタデータ（kind 10002）
  - https://github.com/nostr-protocol/nips/blob/master/65.md
  - ユーザーの優先リレーリストを保存
- NIP-78: アプリケーション固有データ（kind 30078）
  - https://github.com/nostr-protocol/nips/blob/master/78.md
  - リレーに任意のアプリデータを保存するため
- NIP-116（ドラフト）: イベントパス（kind 30079）
  - https://github.com/nostr-protocol/nips/pull/1266
  - パスベースのイベント整理を提案（未マージ）

