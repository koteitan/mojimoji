# Nostr クライアント調査レポート

mojimoji を nostter・rabbit クライアントにプラグイン連携するための調査。

## 概要

| 項目 | nostter | rabbit |
|------|---------|--------|
| **GitHub** | [SnowCait/nostter](https://github.com/SnowCait/nostter) | [syusui-s/rabbit](https://github.com/syusui-s/rabbit) |
| **公開URL** | https://nostter.app/ | https://rabbit.syusui.net/ |
| **UIフレームワーク** | Svelte / SvelteKit | SolidJS |
| **言語** | TypeScript (36.2%), Svelte (61.4%) | TypeScript (96.9%) |
| **ビルドツール** | Vite | Vite |
| **Nostrライブラリ** | nostr-tools, rx-nostr, @rust-nostr/nostr-sdk | nostr-tools, nostr-wasm |
| **プラグインシステム** | なし | なし |

## Note/Event データ型

両クライアントとも `nostr-tools` をEvent型のベースライブラリとして使用。

### nostr-tools Event インターフェース (NIP-01)

```typescript
interface Event {
  id: string;         // 32バイト小文字hex イベントID
  pubkey: string;     // 32バイト小文字hex 公開鍵
  created_at: number; // Unix タイムスタンプ（秒）
  kind: number;       // イベント種別 (1 = ShortTextNote)
  tags: string[][];   // タグ配列の配列
  content: string;    // 任意の文字列
  sig: string;        // 64バイト小文字hex 署名
}
```

### nostter のイベント処理

- `nostr-tools` の Event 型を直接使用
- `rx-nostr` でリアクティブなイベントストリームを統合
- `@rust-nostr/nostr-sdk` で追加のRustベースnostr操作を使用
- タイムライン実装はフィルタベースのクエリとチャンキングで効率的なリレーリクエストを実現

依存ライブラリ:
- `nostr-tools`: ^2.18.2
- `rx-nostr`: ^3.6.1
- `rx-nostr-crypto`: ^3.1.1
- `@rust-nostr/nostr-sdk`: ^0.44.0
- `nip07-awaiter`: ^1.0.0

### rabbit のイベント処理

- `nostr-tools` の Event をカスタムクラスでラップ:
  - `GenericEvent` - プロパティgetterを持つ基底クラス
  - `TextNote` - kind 1 (ShortTextNote) 専用
  - `Reaction` - リアクションイベント用

- GenericEvent が公開するプロパティ:
  - `id`, `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`
  - `createdAtAsDate()` - タイムスタンプをJS Dateに変換

依存ライブラリ:
- `nostr-tools`: 2.10.1
- `nostr-wasm`: ^0.1.0

## プラグインシステム分析

### 現状

nostter も rabbit も、サードパーティモジュール用のプラグインシステムや拡張APIを持っていない。

### 連携オプション

1. **ブラウザ拡張 (NIP-07)**
   - 両クライアントとも NIP-07 署名拡張をサポート (nos2x, Alby など)
   - NIP-07 が提供するもの: `window.nostr.getPublicKey()`, `window.nostr.signEvent()` など
   - 署名/鍵管理に限定され、タイムラインフィルタリングには使えない

2. **フォーク & 修正**
   - リポジトリをクローンして mojimoji を直接統合
   - 別フォークのメンテナンスが必要

3. **スタンドアロンWebアプリ**
   - mojimoji を独立したアプリケーションとして実行
   - 共有リレーを使用してフィルタ済みタイムラインを表示
   - クライアントUIとの直接連携はなし

4. **ブラウザ拡張 (カスタム)**
   - mojimoji をクライアントページに注入するブラウザ拡張を作成
   - 表示前にイベントを傍受してフィルタ可能
   - 実装とメンテナンスが複雑

## mojimoji への推奨事項

### オプションA: スタンドアロンモード (現状)
- 独立したWebアプリケーションとして継続
- ユーザーは mojimoji でリレーとフィルタを設定
- mojimoji 独自のUIでフィルタ済みタイムラインを表示

### オプションB: イベントソース連携
- フィルタ済みイベントストリームをAPIとしてエクスポート
- 他のクライアントが mojimoji の出力を購読可能に
- クライアント側の連携サポート追加が必要

### オプションC: プラグインAPI提案
- nostter/rabbit の GitHub で issue を立ててプラグインAPIを提案
- メンテナーと拡張性について協力
- コミュニティの賛同が必要な長期的解決策

## 技術的互換性

### mojimoji の現在の実装

```typescript
// mojimoji は同様の Event 型を使用 (src/nostr/types.ts)
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}
```

mojimoji が使用するもの:
- `rx-nostr`: リアクティブなイベント購読用
- TypeScript: rabbit と同じ
- Vite: 両クライアントと同じビルドツール

### 互換性メモ

- Event 型は互換性あり (すべて NIP-01 準拠)
- rx-nostr は nostter と共通
- フィルタ済み Observable ストリームを共有できる可能性あり

## 参考資料

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) - ベース nostr ライブラリ
- [NIP-01 仕様](https://github.com/nostr-protocol/nips/blob/master/01.md) - Event フォーマット
- [NIP-07 仕様](https://github.com/nostr-protocol/nips/blob/master/07.md) - ブラウザ拡張API
- [rx-nostr](https://github.com/penpenpng/rx-nostr) - リアクティブ nostr ライブラリ
- [nos2x](https://github.com/fiatjaf/nos2x) - NIP-07 署名拡張
