# nico pong

ニコニコ生放送の **動画紹介放送** を支援する Chrome 拡張です。
最新仕様書: [`docs/nico-pong-v0.2-feature-additions-api-direct.md`](docs/nico-pong-v0.2-feature-additions-api-direct.md)
基礎仕様: [`docs/nico-pong-v0.1-ai-instructions.md`](docs/nico-pong-v0.1-ai-instructions.md)

ログイン済みブラウザセッションを利用して動画引用再生・生主コメント投稿・コメントリクエスト受付を支援します。
ニコニコのID／パスワード／Cookie値は収集しません。動画リスト・設定・コテハン情報・NG情報はブラウザ内に保存されます。
ニコニコ側の内部API仕様変更により、一部機能が動作しなくなる可能性があります。

## v0.2 で追加されたこと

- マイリストURL / `mylist/12345` から動画を一括読み込み（リクエスト / ストックへ追加）
- 再生中動画情報を **生主コメント** として投稿（テンプレ変数対応、再生成功時の自動投稿）
- リクエストタブの **自動連続再生の安定化**（連続エラー時の自動一時停止つき）
- ストック → リクエストへの **コピー / 移動** ボタン
- ニコ生 **コメント接続**（WebSocket + NDGRストリーム）
- コメントから `sm/nm/so` / ニコ動URLを拾って **リクエスト自動登録**
- `@コテハン` / 名札の検出と保存
- **NG動画 / 引用不可動画 の自動マーキング**（`quotable=false` を `no_live_play` 化）

## v0.1 でできること

- Chrome の Side Panel に管理 UI を表示
- 開いているニコ生番組ページ (`live.nicovideo.jp/watch/lv...`) から `lvID` と番組タイトルを取得して表示
- 動画 ID または動画 URL を入力して動画ブロックを追加
- 「リクエスト」「ストック」の 2 タブで動画を管理
- 同一タブ内で動画ブロックを **ドラッグ＆ドロップで並び替え**
- 動画ブロックの削除、作者名の手動編集
- IndexedDB によるブラウザ内ローカル保存（リロード後も残る）
- 同一タブ内の同じ動画 ID の重複追加を防止

## v0.2.1-alpha 時点でのコメントリクエスト機能の扱い

コメント受信は **protobufjs による NDGR 正式 decode** で実装しました
(`src/proto/ndgr.proto` / `src/sidepanel/services/ndgrCodec.ts`)。
取り込み内容は次の通りです。

- `message.chat.content` をコメント本文
- `message.chat.no` をコメント番号
- `message.chat.hashedUserId` / `meta.id` を userId
- `message.chat.name` を名札 (nametag)
- `state.marquee.display.operatorComment.content` は **運営/生主コメント** として扱い、
  リクエスト対象から除外 (`isOperatorComment=true`)

ただし NDGR は Dwango 内部仕様で公式安定保証がないため、本機能は **v0.2.1-alpha** 扱いとし、
proto 定義の追従が必要になるケースに備え、正式 decode が失敗したチャンクに対しては
従来の **best-effort 正規表現抽出にフォールバック**します
(検出可否のみ動作、userId/no は不明)。

### 既知の制約

- 公式 NG ワード/NG ユーザー同期はローカル設定のみ
- タブ間 D&D 移動（コピー/移動ボタンで代替）
- ロング接続維持のための offscreen document 化は未実装 (Side Panel 開放中のみ動作)

## 動画情報取得について

`src/shared/nicoVideoApi.ts` の `fetchNicoVideoInfo()` は `ext.nicovideo.jp/api/getthumbinfo` を
利用した実装になっています（v0.1 のモックは廃止）。`VITE_USE_MOCK_VIDEO_API=true` を環境変数で
指定するとモック実装に切り替わります。

## ローカル開発

### 必要環境

- Node.js 20 LTS 以上
- npm

### セットアップとビルド

```bash
npm install
npm run build
```

ビルド成果物は `dist/` に出力されます。
ファイルを編集しながら自動ビルドしたい場合：

```bash
npm run build:watch
```

### Chrome への読み込み手順

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパー モード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリの **`dist/`** ディレクトリを選択
5. ツールバーの拡張アイコン（nico pong）をクリックすると Side Panel が開く
6. `https://live.nicovideo.jp/watch/lv...` を開いた状態だと番組情報が取得されます

## 使用する Chrome 権限と理由

`manifest.json` で要求する権限と理由は以下のとおりです（仕様書 §4, §15）。

| 権限 | 用途 |
| --- | --- |
| `sidePanel` | UI を Chrome Side Panel に表示するため |
| `storage` | 設定（アクティブタブ等）を `chrome.storage.local` に保存するため |
| `tabs` | アクティブなタブの URL を判定し、ニコ生ページに対して content script へメッセージを送るため |
| `scripting` | 将来必要になった際にスクリプト注入を行うため（v0.1 では宣言のみで未使用） |
| `host_permissions: https://live.nicovideo.jp/*` | ニコ生番組ページから情報取得するため |
| `host_permissions: https://live2.nicovideo.jp/*` | 生主コメント投稿 API のため |
| `host_permissions: https://www.nicovideo.jp/*` | 動画情報・マイリスト RSS 取得のため |
| `host_permissions: https://ext.nicovideo.jp/*` | getthumbinfo 動画情報取得のため |
| `host_permissions: https://nvapi.nicovideo.jp/*` | マイリスト API フォールバックのため |
| `host_permissions: https://services-eapi.spi.nicovideo.jp/*` | 動画引用再生 API のため |
| `host_permissions: https://*.live.dwango.jp/*` / `wss://*.live.dwango.jp/*` | NDGR コメントストリームのため |
| `host_permissions: wss://*.live.nicovideo.jp/*` 他 | ニコ生 relive WebSocket のため |

**含まれていない権限：**

- `cookies` — Cookie を直接読み書きしないため
- `https://*/*` のような広範な host permission — 不要

## プライバシー方針

- ニコニコ動画／ニコ生の **ID／パスワードを入力させません**
- **Cookie を直接読みません**（`cookies` permission も持ちません）
- 取得した動画リスト・番組情報は **ユーザーのブラウザ内 (IndexedDB / `chrome.storage.local`) にのみ保存** します
- **外部サーバへユーザーデータを送信しません**
- Content Script は `https://live.nicovideo.jp/watch/lv*` にのみ注入されます

## ディレクトリ構成

```
nico-pong/
├─ manifest.json は public/manifest.json から dist/ に配置されます
├─ public/
│  ├─ manifest.json
│  └─ icons/
├─ src/
│  ├─ background/serviceWorker.ts        # MV3 Service Worker
│  ├─ content/nicoliveContentScript.ts   # ニコ生ページ用 content script
│  ├─ shared/                            # 共通の型・ユーティリティ・API ラッパ
│  ├─ storage/                           # IndexedDB / chrome.storage の保存層
│  └─ sidepanel/                         # React 製の Side Panel UI
└─ docs/nico-pong-v0.1-ai-instructions.md  # 仕様書
```

## ライセンス

未定（リポジトリ管理者の方針に従ってください）。
