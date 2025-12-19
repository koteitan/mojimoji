# mojimoji

Nostrのモジュラー型フィルタプレビューワーです。モジュラー＋モデレーション = mojimoji

## 使い方

- **Relayノード**: Nostrリレーに接続してイベントを取得
- **Filterノード**: 条件でイベントをフィルタリング（演算, 検索, 言語）
- **Timelineノード**: フィルタされたイベントを表示

### はじめに

1. ブラウザでアプリケーションを開く
2. Relay -> Timeline のデフォルトグラフが作成される
3. 左側のタイムラインパネルにイベントが表示され始める

### グラフエディタ

#### ノードの追加

- ツールバーボタンをクリック: `+Relay`, `+Filter`, `+Timeline`
- またはキーボードショートカットを使用（下記参照）

#### ノードの接続

1. ソケットをクリック(緑色になる)
2. もう片方のソケットをクリック (接続が作成される)

#### 削除

- ノードの削除: ノードをクリックして選択し、`d`または`Delete`キーを押す。またはツールバーの`Delete`ボタンをクリック
- 接続の削除: ソケット(端点)をクリックして選択し、`d`または`Delete`キーを押す。またはツールバーの`Delete`ボタンをクリック

#### ナビゲーション

- **ズーム**: マウスホイールまたはピンチジェスチャー
- **パン**: 背景をドラッグ
- **中央に移動**: `c`キーを押すか`Center`ボタンをクリック

#### 保存と読み込み

- **保存**: `Save`ボタンをクリックまたは`Ctrl+S`を押す
  - Browser（localStorage）、Nostr Relay、またはファイルに保存
- **読み込み**: `Load`ボタンをクリックまたは`Ctrl+O`を押す
  - Browser、Nostr Relay、またはファイルから読み込み

### キーボードショートカット

| キー | 動作 |
|------|------|
| r | Relayノードを追加 |
| f | Filterドロップダウンを切り替え |
| o | Operatorノードを追加 |
| s | Searchノードを追加 |
| l | Languageノードを追加 |
| t | Timelineノードを追加 |
| c | ビューを中央に |
| d | 選択を削除 |
| Ctrl+S | グラフを保存 |
| Ctrl+O | グラフを読み込み |

### ノードの種類

#### Relayノード
- **Relay URLs**: リレーのWebSocket URLを入力（1行に1つ）
- **Filters**: NIP-01フィルタを設定（kinds、authors等）

#### Operatorノード
- 2つのイベントストリームをAND、OR、またはA-B（差分）で結合

#### Searchノード
- キーワードまたは正規表現パターンでイベントをフィルタ

#### Languageノード
- 検出された言語でイベントをフィルタ（日本語、英語、中国語など）

#### Timelineノード
- スクロール可能なリストでイベントを表示
- カスタムタイムライン名を設定

### データの永続化

- グラフのレイアウトと設定はフォーカスロスト時にlocalStorageに保存される
- プロファイルキャッシュは高速読み込みのために保存される

## 開発者ガイド

### ドキュメント

| ドキュメント | 説明 |
|--------------|------|
| [spec/main.md](spec/main.md) | メイン仕様書（UI、動作、i18n、実装） |
| [spec/save.md](spec/save.md) | 保存/読込ダイアログ仕様 |
| [spec/save-ja.md](spec/save-ja.md) | 保存/読込ダイアログ仕様（日本語） |
| [spec/timeline.md](spec/timeline.md) | タイムライン仕様と将来計画（NIP-36、画像表示） |
| [clients.md](clients.md) | Nostrクライアント比較 |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | サードパーティライブラリライセンス |
| [README.md](README.md) | README（英語） |

### 技術スタック

- **言語**: TypeScript
- **ビルドツール**: Vite
- **UIフレームワーク**: React
- **グラフエディタ**: rete.js
- **Nostrクライアント**: rx-nostr
- **リアクティブ**: RxJS
- **国際化**: react-i18next

### セットアップ

```bash
# 依存関係をインストール
npm install

# 開発サーバーを起動
npm run dev

# 本番用にビルド
npm run build

# 型チェック
npm run tsc
```

### GitHub Pagesへのデプロイ

GitHub Actionsで自動デプロイされます。`main`ブランチにpushするだけ：

```bash
git push
```

GitHub Actionsが自動的に：
1. 依存関係をインストール
2. 正しいベースパス（`/mojimoji/`）でアプリをビルド
3. GitHub Pagesにデプロイ

### プロジェクト構造

```
src/
+-- main.tsx              # エントリーポイント
+-- App.tsx               # メインアプリコンポーネント
+-- components/
|   +-- Graph/
|   |   +-- GraphEditor.tsx    # メイングラフエディタ
|   |   +-- CustomNode.tsx     # ノードレンダラー
|   |   +-- CustomSocket.tsx   # ソケットレンダラー
|   |   +-- CustomConnection.tsx
|   |   +-- nodes/
|   |       +-- RelayNode.ts   # リレー購読
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

### デバッグツール

ブラウザコンソールを開いて実行：

- `dumpgraph()` - グラフ構造を出力
- `dumpsub()` - リレー購読状態を出力
- `infocache()` - プロファイルキャッシュ情報を出力

### 新しいノードタイプの追加

1. `src/components/Graph/nodes/YourNode.ts`を作成
2. `src/components/Graph/nodes/index.ts`からエクスポート
3. `GraphEditor.tsx`の`NodeTypes`ユニオンに追加
4. `addNode()`関数にケースを追加
5. `rebuildPipeline()`にワイヤリングロジックを追加
6. `locales/*.json`にi18n翻訳を追加
7. `spec.md`を更新

### コードスタイル

- TypeScript strictモードを使用
- ノード実装の既存パターンに従う
- 開発ログ用に`DEBUG`フラグを追加
- バンドルサイズを最小限に

### 参考資料

- [rete.js ドキュメント](https://rete.js.org/)
- [rx-nostr ドキュメント](https://penpenpng.github.io/rx-nostr/)
- [NIP-01 仕様](https://github.com/nostr-protocol/nips/blob/master/01.md)

## ライセンス

MIT

サードパーティライブラリのライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。
