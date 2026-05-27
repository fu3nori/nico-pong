# nico pong v0.1 AI実装指示書

## 0. このMDの目的

この文書は、AIコーディングエージェントに **Chrome拡張「nico pong」v0.1** を実装させるための指示書である。

nico pong は、ニコニコ生放送の動画紹介放送を支援する Chrome 拡張である。  
v0.1 では、PitaCore / NicoPitaCore 的な本格機能のうち、最初の土台だけを作る。

v0.1 のゴールは以下。

- Chrome Manifest V3 拡張として動作する
- `live.nicovideo.jp/watch/lv...` の生放送ページで有効になる
- Chrome Side Panel に管理UIを表示する
- 現在開いているニコ生番組の `lvID` と番組タイトルを取得して表示する
- 動画IDまたはニコニコ動画URLを入力できる
- 入力された動画の情報を取得し、動画ブロックとして表示する
- 「リクエスト」タブと「ストック」タブを持つ
- 入力フォームから追加した動画は、現在アクティブなタブへ保存される
- 動画ブロックはドラッグ＆ドロップで並び替えできる
- データはブラウザ内ローカルに保存する
- 外部サーバーへユーザーデータを送信しない

v0.1 では、以下は実装しない。

- ニコ生コメントのリアルタイム取得
- コメントからの動画リクエスト自動受付
- 生主コメント投稿
- ニコ生の動画紹介機能の再生/停止制御
- 自動再生
- 公式NGワード/NGユーザーとの同期
- Chrome Web Store提出作業そのもの

ただし、将来実装しやすいように設計だけは分離しておく。

---

## 1. プロダクト概要

### 1.1 アプリ名

仮称：`nico pong`

### 1.2 コンセプト

`nico pong` は、ニコニコ生放送で動画紹介放送を行う生主向けの Chrome 拡張である。

放送中に紹介したい動画を「リクエスト」と「ストック」に分けて管理し、動画IDからタイトル・サムネイル・投稿者名・再生数・コメント数・マイリスト数・いいね数などを取得して、放送進行に使いやすい形で表示する。

### 1.3 v0.1の主な価値

- Chromeユーザーが使える、動画紹介放送用のSide Panel管理画面
- 放送ページを開いたまま、右側パネルで動画リストを管理できる
- 動画IDの羅列ではなく、サムネイル付きの動画ブロックで管理できる
- 事前ストックと当日リクエストを分けられる
- 後続バージョンでコメント受付・再生制御・生主コメント投稿を追加できる土台になる

---

## 2. 技術スタック

AIは以下の構成で実装すること。

### 2.1 必須

- Chrome Extension Manifest V3
- TypeScript
- React
- Vite
- CSS Modules または通常CSS
- `chrome.sidePanel`
- `chrome.storage.local`
- IndexedDB
- Drag and Drop 実装
  - 可能なら `@dnd-kit/core` / `@dnd-kit/sortable`
  - 依存を増やしたくない場合はHTML5 Drag and Dropでもよい

### 2.2 推奨

- Node.js 20 LTS 以上
- npm
- ESLint
- Prettier

### 2.3 v0.1では避けること

- 外部バックエンドサーバー
- ユーザーCookieの直接読み取り
- `cookies` permission
- ID/パスワード入力欄
- 任意サイトへの広範なhost permission
- ニコニコ以外のページへのcontent script注入
- 過剰なChrome権限

---

## 3. Chrome拡張としての基本方針

### 3.1 Manifest V3

`manifest.json` は Manifest V3 で作成する。

### 3.2 Side Panel

UIはChromeのSide Panelで表示する。

拡張アイコンをクリックしたらSide Panelが開くようにする。

### 3.3 Content Script

`live.nicovideo.jp/watch/lv...` のページに content script を注入し、以下を取得する。

- 現在のページURL
- `lvID`
- 番組タイトル
- 生放送ページかどうか

v0.1では、ログイン状態や生主権限の厳密判定は「取得できれば表示」程度でよい。  
ただし、将来に備えて `programStatus` として以下のような状態を持てるようにしておく。

```ts
type ProgramConnectionStatus =
  | "not_nicolive_page"
  | "detected"
  | "unknown"
  | "error";
```

### 3.4 Service Worker

Manifest V3 の background は service worker とする。

Service Workerの役割は以下。

- 拡張アイコンクリック時にSide Panelを開けるようにする
- 対象タブがニコ生ページか判定する
- Side Panel と Content Script のメッセージ橋渡し
- 必要に応じて動画情報取得APIを呼ぶ

Service WorkerにDOM操作を書かないこと。

### 3.5 保存

設定値など軽いものは `chrome.storage.local`。  
動画リストなど増えるデータは IndexedDB に保存する。

---

## 4. 権限設計

v0.1 の `manifest.json` 権限は最小限にする。

```json
{
  "manifest_version": 3,
  "name": "nico pong",
  "version": "0.1.0",
  "description": "ニコニコ生放送の動画紹介放送を支援するChrome拡張です。",
  "permissions": [
    "sidePanel",
    "storage",
    "tabs",
    "scripting"
  ],
  "host_permissions": [
    "https://live.nicovideo.jp/*",
    "https://www.nicovideo.jp/*",
    "https://nvapi.nicovideo.jp/*"
  ],
  "background": {
    "service_worker": "src/background/serviceWorker.js",
    "type": "module"
  },
  "action": {
    "default_title": "nico pong"
  },
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "content_scripts": [
    {
      "matches": [
        "https://live.nicovideo.jp/watch/lv*"
      ],
      "js": [
        "src/content/nicoliveContentScript.js"
      ],
      "run_at": "document_idle"
    }
  ]
}
```

実際のビルド後パスはViteの構成に合わせて調整してよい。

注意：

- `cookies` permission はv0.1では使わない
- `https://*/*` のような広すぎるhost permissionは禁止
- `activeTab` を使う設計でもよいが、v0.1では対象サイト固定の方が実装しやすい
- Chrome Web Store配布を見据え、権限の理由をREADMEに明記する

---

## 5. ディレクトリ構成

推奨構成は以下。

```text
nico-pong/
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ manifest.json
├─ README.md
├─ public/
│  └─ icons/
│     ├─ icon-16.png
│     ├─ icon-48.png
│     └─ icon-128.png
└─ src/
   ├─ background/
   │  └─ serviceWorker.ts
   ├─ content/
   │  └─ nicoliveContentScript.ts
   ├─ sidepanel/
   │  ├─ index.html
   │  ├─ main.tsx
   │  ├─ App.tsx
   │  ├─ styles.css
   │  ├─ components/
   │  │  ├─ Header.tsx
   │  │  ├─ VideoInputForm.tsx
   │  │  ├─ Tabs.tsx
   │  │  ├─ VideoList.tsx
   │  │  └─ VideoCard.tsx
   │  └─ hooks/
   │     ├─ useActiveTab.ts
   │     ├─ useProgramInfo.ts
   │     └─ useVideoLists.ts
   ├─ shared/
   │  ├─ types.ts
   │  ├─ constants.ts
   │  ├─ messaging.ts
   │  ├─ nicoVideoId.ts
   │  ├─ authorName.ts
   │  └─ format.ts
   └─ storage/
      ├─ db.ts
      ├─ videoRepository.ts
      └─ settingsRepository.ts
```

---

## 6. 主要データ型

`src/shared/types.ts` に定義する。

```ts
export type NicoPongTab = "request" | "stock";

export type ProgramConnectionStatus =
  | "not_nicolive_page"
  | "detected"
  | "unknown"
  | "error";

export type ProgramInfo = {
  status: ProgramConnectionStatus;
  lvId?: string;
  title?: string;
  url?: string;
  detectedAt: string;
  errorMessage?: string;
};

export type AuthorNameSource =
  | "owner"
  | "tag_p"
  | "tag_work"
  | "tag_person"
  | "manual"
  | "unknown";

export type NicoPongVideo = {
  id: string;                 // UUID。内部管理ID
  videoId: string;            // sm12345678 等
  url: string;

  title: string;
  thumbnailUrl?: string;

  ownerName?: string;
  ownerId?: string;

  displayAuthorName?: string;
  authorNameSource: AuthorNameSource;

  viewCount?: number;
  commentCount?: number;
  mylistCount?: number;
  likeCount?: number;
  durationSec?: number;

  tags: string[];
  lockedTags?: string[];

  memo?: string;

  addedTo: NicoPongTab;
  order: number;

  addedAt: string;
  updatedAt: string;
  lastFetchedAt?: string;
};

export type VideoFetchResult =
  | {
      ok: true;
      video: Omit<NicoPongVideo, "id" | "addedTo" | "order" | "addedAt" | "updatedAt">;
    }
  | {
      ok: false;
      videoId?: string;
      errorMessage: string;
    };
```

---

## 7. 番組情報取得仕様

### 7.1 lvID取得

Content Scriptで現在URLを見て取得する。

対象URL例：

```text
https://live.nicovideo.jp/watch/lv123456789
https://live.nicovideo.jp/watch/lv123456789?ref=...
```

取得ルール：

```ts
const match = location.pathname.match(/\/watch\/(lv\d+)/);
```

### 7.2 番組タイトル取得

v0.1ではDOMから取得する。

候補：

- `document.title`
- ページ内の番組タイトルらしい見出し要素
- `meta[property="og:title"]`
- `meta[name="twitter:title"]`

実装方針：

1. `meta[property="og:title"]` があれば優先
2. なければ `document.title`
3. ニコニコ側の接尾辞や不要な文字列があれば軽く除去
4. 取得できなければ `lvID` をタイトル代わりにする

例：

```ts
function detectProgramInfo(): ProgramInfo {
  const lvId = location.pathname.match(/\/watch\/(lv\d+)/)?.[1];

  if (!lvId) {
    return {
      status: "not_nicolive_page",
      detectedAt: new Date().toISOString(),
      url: location.href,
    };
  }

  const ogTitle =
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;

  const rawTitle = ogTitle || document.title || lvId;

  return {
    status: "detected",
    lvId,
    title: normalizeNicoliveTitle(rawTitle),
    url: location.href,
    detectedAt: new Date().toISOString(),
  };
}
```

---

## 8. 動画ID入力仕様

### 8.1 入力フォーム

Side Panel上部に常時表示する。

```text
動画ID / URL: [                           ] [追加]
```

### 8.2 入力可能形式

以下に対応する。

```text
sm12345678
nm12345678
so12345678
https://www.nicovideo.jp/watch/sm12345678
http://www.nicovideo.jp/watch/sm12345678
https://nico.ms/sm12345678
```

### 8.3 抽出関数

`src/shared/nicoVideoId.ts` に実装する。

```ts
export function extractNicoVideoId(input: string): string | null {
  const trimmed = input.trim();

  const direct = trimmed.match(/^(sm|nm|so)\d+$/i);
  if (direct) return direct[0].toLowerCase();

  const fromUrl = trimmed.match(/(?:watch\/|nico\.ms\/)((?:sm|nm|so)\d+)/i);
  if (fromUrl) return fromUrl[1].toLowerCase();

  const anywhere = trimmed.match(/\b((?:sm|nm|so)\d+)\b/i);
  if (anywhere) return anywhere[1].toLowerCase();

  return null;
}
```

### 8.4 追加先

現在アクティブなタブへ追加する。

- リクエストタブがアクティブ → `addedTo: "request"`
- ストックタブがアクティブ → `addedTo: "stock"`

---

## 9. 動画情報取得仕様

### 9.1 v0.1の取得方針

v0.1では、動画情報取得は実装可能な範囲で行う。

推奨順：

1. `https://www.nicovideo.jp/watch/{videoId}` またはニコニコの公開/半公開APIから情報取得
2. 取得できない項目は `undefined`
3. 取得失敗時はエラー表示
4. 動画ブロックを作れない場合は保存しない

実装時点で安定したAPIが不明な場合は、以下の2段階で作ること。

- `nicoVideoApi.ts` に実装を隔離する
- 最初はモック実装を作り、後で実APIに差し替え可能にする

```ts
export async function fetchNicoVideoInfo(videoId: string): Promise<VideoFetchResult> {
  // TODO: 実API調査後に差し替える
}
```

### 9.2 必須表示項目

動画ブロックでは以下を表示する。

- サムネイル
- タイトル
- 作者名
- 動画ID
- 再生数
- コメント数
- マイリスト数
- いいね数
- 再生時間
- タグ候補

取得できない項目は `-` と表示する。

### 9.3 作者名推定

`ownerName` をデフォルトにする。  
ただしタグに以下がある場合は、作者名として優先する。

優先順位：

1. 手動指定作者名
2. ロック済みタグの `○○P`
3. ロック済みタグの `○○作品`
4. ロック済みタグの `○○の人`
5. 通常タグの `○○P`
6. 通常タグの `○○作品`
7. 通常タグの `○○の人`
8. 投稿者アカウント名
9. 不明

実装例：

```ts
export function inferDisplayAuthorName(params: {
  ownerName?: string;
  tags: string[];
  lockedTags?: string[];
  manualAuthorName?: string;
}): { name?: string; source: AuthorNameSource } {
  if (params.manualAuthorName?.trim()) {
    return { name: params.manualAuthorName.trim(), source: "manual" };
  }

  const locked = params.lockedTags ?? [];
  const normal = params.tags ?? [];

  const patterns: Array<{ source: AuthorNameSource; regex: RegExp }> = [
    { source: "tag_p", regex: /^.{1,32}P$/ },
    { source: "tag_work", regex: /^.{1,32}作品$/ },
    { source: "tag_person", regex: /^.{1,32}の人$/ },
  ];

  for (const tagList of [locked, normal]) {
    for (const pattern of patterns) {
      const found = tagList.find((tag) => pattern.regex.test(tag));
      if (found) return { name: found, source: pattern.source };
    }
  }

  if (params.ownerName) return { name: params.ownerName, source: "owner" };

  return { source: "unknown" };
}
```

注意：

- `○○作品` は作者名ではなく作品カテゴリの場合もある
- そのため、v0.1でも作者名を手動編集できるUIを用意する
- 手動編集された作者名は `authorNameSource: "manual"` として保存する

---

## 10. UI仕様

### 10.1 全体

Side Panelの最上部にヘッダーを置く。

```text
nico pong
番組: {番組タイトル}
lvID: {lvID}
状態: {接続状態}
```

### 10.2 入力フォーム

ヘッダー直下に表示。

```text
動画ID / URL [____________________] [追加]
追加先: 現在のタブ（リクエスト / ストック）
```

### 10.3 タブ

v0.1では以下。

```text
[リクエスト] [ストック]
```

将来用に以下のタブ名を予約してもよいが、v0.1では非表示でよい。

```text
[再生中] [コメント] [設定] [履歴] [NG管理]
```

### 10.4 リクエストタブ

表示内容：

- リクエストに追加された動画ブロック一覧
- 上から順に再生候補になる想定
- v0.1では再生ボタンは「未実装」または「disabled」
- D&Dで順番を変更できる

### 10.5 ストックタブ

表示内容：

- 事前ストック動画ブロック一覧
- 手動放送用の倉庫
- v0.1では再生ボタンは「未実装」または「disabled」
- D&Dで順番を変更できる

### 10.6 動画ブロック

1動画を1ブロックとして表示。

```text
┌─────────────────────────────
│ [サムネイル]
│ タイトル
│ 作者: {displayAuthorName}  [編集]
│ ID: sm12345678
│ 再生: 12,345 / コメ: 678 / マイリス: 90 / いいね: 123
│ 時間: 03:45
│ タグ: tag1, tag2, tag3
│ [↑↓ drag handle] [削除]
└─────────────────────────────
```

### 10.7 状態表示

以下の状態を出す。

- 動画情報取得中
- 追加成功
- 入力エラー
- 動画情報取得失敗
- 保存失敗
- 並び替え保存済み

---

## 11. Drag and Drop仕様

### 11.1 同一タブ内並び替え

v0.1では同一タブ内の並び替えだけ必須。

- リクエスト内で並び替え
- ストック内で並び替え

### 11.2 タブ間移動

v0.1では必須ではない。  
余裕があれば、動画ブロックに以下のボタンを付ける。

- `ストックへ送る`
- `リクエストへ送る`

D&Dでタブ間移動はv0.2以降でよい。

### 11.3 order保存

並び替え後、各動画の `order` を再採番して保存する。

---

## 12. 保存仕様

### 12.1 IndexedDB

DB名：

```text
nico-pong-db
```

バージョン：

```text
1
```

Object Store：

```text
videos
```

Key：

```text
id
```

Index：

- `addedTo`
- `videoId`
- `order`
- `updatedAt`

### 12.2 Repository

`videoRepository.ts` に以下を実装する。

```ts
export async function listVideos(tab: NicoPongTab): Promise<NicoPongVideo[]>;

export async function addVideo(
  tab: NicoPongTab,
  video: Omit<NicoPongVideo, "id" | "addedTo" | "order" | "addedAt" | "updatedAt">
): Promise<NicoPongVideo>;

export async function updateVideo(video: NicoPongVideo): Promise<void>;

export async function deleteVideo(id: string): Promise<void>;

export async function reorderVideos(tab: NicoPongTab, idsInOrder: string[]): Promise<void>;

export async function findByVideoId(
  tab: NicoPongTab,
  videoId: string
): Promise<NicoPongVideo | null>;
```

### 12.3 重複チェック

v0.1では、同一タブ内で同じ `videoId` が既に存在する場合は追加しない。

表示：

```text
この動画は既にリクエストに追加されています。
```

将来は「ストックにはあるがリクエストにはない」などの警告を出す。

---

## 13. メッセージング仕様

`src/shared/messaging.ts` にメッセージ型をまとめる。

```ts
export type NicoPongMessage =
  | { type: "GET_PROGRAM_INFO" }
  | { type: "PROGRAM_INFO_RESULT"; payload: ProgramInfo }
  | { type: "FETCH_VIDEO_INFO"; payload: { videoId: string } }
  | { type: "FETCH_VIDEO_INFO_RESULT"; payload: VideoFetchResult };
```

### 13.1 Side Panel → Content Script

- 現在のタブに対して `GET_PROGRAM_INFO` を送る
- Content Scriptが `ProgramInfo` を返す

### 13.2 Side Panel / Service Worker → 動画情報取得

- `FETCH_VIDEO_INFO` を呼ぶ
- 結果をSide Panelに返す

実装の都合で、動画情報取得はSide Panelから直接fetchしてもよい。  
ただし、将来の権限管理・CORS回避を考え、`nicoVideoApi.ts` に隔離すること。

---

## 14. エラーハンドリング

最低限、以下を実装する。

### 14.1 番組検出エラー

- ニコ生ページではない
- lvIDが取れない
- タイトルが取れない

### 14.2 動画入力エラー

- 空欄
- 動画IDが見つからない
- 対応外ID
- 取得失敗
- 重複

### 14.3 保存エラー

- IndexedDB初期化失敗
- 保存失敗
- 並び替え保存失敗

### 14.4 表示方針

エラーは `alert()` ではなく、Side Panel内のトーストまたはメッセージ領域に表示する。

---

## 15. セキュリティ・プライバシー方針

v0.1では以下を守ること。

- ニコニコのID/パスワードを入力させない
- Cookieを直接読まない
- `cookies` permissionを使わない
- 取得した動画リスト・番組情報はローカル保存のみ
- 外部サーバーへ送信しない
- Content Scriptは `live.nicovideo.jp/watch/lv*` のみに注入する
- 不要なサイト権限を要求しない
- READMEに「データは基本的にブラウザ内に保存される」と明記する

---

## 16. 実装タスク分解

AIは以下の順番で実装すること。

### Task 1: プロジェクト初期化

- Vite + React + TypeScript プロジェクトを作成
- Chrome拡張としてビルドできる設定を作る
- `manifest.json` を配置
- build後にChromeの「パッケージ化されていない拡張機能」として読み込めるようにする

完了条件：

- `npm install`
- `npm run build`
- `dist/` をChrome拡張として読み込める

### Task 2: Side Panel表示

- 拡張アイコンをクリックするとSide Panelが開く
- Side Panelに `nico pong` と表示される
- `live.nicovideo.jp` 以外でも表示はできてよいが、ヘッダーで「ニコ生ページではありません」と出す

完了条件：

- ChromeでSide Panelが開く
- React UIが表示される

### Task 3: 番組情報取得

- Content Scriptを作成
- `lvID` と番組タイトルを取得
- Side Panelに表示

完了条件：

- `https://live.nicovideo.jp/watch/lv...` でSide Panelに番組情報が出る
- 別サイトでは「ニコ生ページではありません」と出る

### Task 4: タブUI

- リクエストタブ
- ストックタブ
- アクティブタブ状態管理

完了条件：

- タブを切り替えられる
- 入力フォームの「追加先」が現在タブに応じて変わる

### Task 5: 動画ID入力

- 入力フォーム作成
- `extractNicoVideoId()` 実装
- 対応形式をテスト

完了条件：

- `sm12345678`
- `https://www.nicovideo.jp/watch/sm12345678`
- `https://nico.ms/sm12345678`

から `sm12345678` が抽出できる

### Task 6: 動画情報取得

- `fetchNicoVideoInfo(videoId)` を実装
- 実APIが不安定な場合はモック実装でUIを完成させる
- API実装は必ず1ファイルに隔離する

完了条件：

- 動画ID入力後、動画ブロック用データが返る
- 取得失敗時にエラー表示される

### Task 7: IndexedDB保存

- DB初期化
- 動画保存
- タブ別一覧取得
- 削除
- 並び替え保存

完了条件：

- ページを閉じても追加動画が残る
- リクエスト/ストックが分かれて保存される

### Task 8: 動画ブロック表示

- サムネイル
- タイトル
- 作者名
- 動画ID
- 再生数/コメント数/マイリスト数/いいね数
- タグ
- 削除ボタン
- 作者名編集

完了条件：

- 追加した動画が見やすいブロックで表示される
- 作者名を手動変更できる

### Task 9: D&D並び替え

- 同一タブ内で動画ブロックを並び替え
- 並び替え後に保存

完了条件：

- リロード後も順番が維持される

### Task 10: README作成

READMEに以下を書く。

- nico pongの概要
- v0.1の機能
- 未実装機能
- ローカル開発方法
- Chromeへの読み込み方法
- 使用権限の理由
- プライバシー方針

---

## 17. 受け入れ基準

v0.1は以下を満たしたら完成とする。

- Chrome拡張として読み込める
- 拡張アイコンからSide Panelを開ける
- ニコ生ページで番組タイトルとlvIDを取得できる
- リクエスト/ストックの2タブを切り替えられる
- 動画ID/URL入力から動画IDを抽出できる
- 動画情報を取得またはモック生成できる
- アクティブタブに動画ブロックを追加できる
- 同一タブ内の重複追加を防げる
- 動画ブロックを削除できる
- 作者名を手動編集できる
- 同一タブ内でD&D並び替えできる
- リロード後もデータが残る
- 不要な権限を要求していない
- ID/パスワード/Cookieを直接扱っていない
- READMEがある

---

## 18. 将来拡張のために残す設計メモ

v0.1では実装しないが、将来のために以下の責務は分離しておく。

### 18.1 CommentProvider

将来、ニコ生コメントを取得するための抽象層。

```ts
export interface CommentProvider {
  connect(lvId: string): Promise<void>;
  disconnect(): Promise<void>;
  onComment(callback: (comment: NicoLiveComment) => void): void;
}
```

### 18.2 PlayerController

将来、動画紹介機能の再生/停止/スキップを扱う抽象層。

```ts
export interface PlayerController {
  play(videoId: string): Promise<void>;
  stop(): Promise<void>;
  skip(): Promise<void>;
}
```

### 18.3 BroadcasterCommentPoster

将来、生主コメント投稿を扱う抽象層。

```ts
export interface BroadcasterCommentPoster {
  post(text: string): Promise<void>;
}
```

### 18.4 NGManager

将来、nico pong独自NGとニコ生公式NGの連携を扱う抽象層。

```ts
export interface NGManager {
  isBlockedVideo(video: NicoPongVideo): Promise<boolean>;
  isBlockedUser(userId: string): Promise<boolean>;
}
```

---

## 19. AIへの実装時注意

AIは以下を守ること。

- 一度に巨大な実装を作らず、Task単位で実装する
- 実装後に必ずビルドエラーを確認する
- 型エラーを残さない
- Chrome拡張のパス解決に注意する
- Service WorkerにDOM依存コードを書かない
- Content ScriptとSide Panelの役割を混ぜない
- ニコニコの仕様が不明な箇所は `TODO:` を残してモックで進める
- ユーザーのログイン情報やCookieを直接扱わない
- 外部送信する処理を勝手に追加しない
- API取得処理は必ず差し替え可能にする
- READMEを必ず更新する

---

## 20. 最初にAIへ投げるプロンプト例

以下をAIコーディングエージェントに渡して開始する。

```text
このリポジトリに Chrome Manifest V3 拡張「nico pong」v0.1 を実装してください。
仕様は docs/nico-pong-v0.1-ai-instructions.md に従ってください。

まずは Task 1〜Task 3 までを実装してください。

要件：
- Vite + React + TypeScript
- Chrome Side Panel対応
- live.nicovideo.jp/watch/lv* にcontent scriptを注入
- Side Panelから現在タブの番組情報を取得
- lvIDと番組タイトルを表示
- CookieやID/パスワードは扱わない
- 外部サーバーへユーザーデータを送信しない
- ビルドが通る状態にしてください

実装後、以下を報告してください。
1. 作成/変更したファイル
2. 実装内容
3. 動作確認手順
4. 未実装/TODO
```

---

## 21. 参考資料

実装時は最新の公式ドキュメントを確認すること。

- Chrome Extensions API reference
- Chrome Side Panel API
- Chrome Content Scripts
- Chrome Manifest file format
- Chrome Manifest V3 Service Worker migration
- Chrome Storage API
- Chrome Web Store Program Policies

