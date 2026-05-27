# nico pong v0.2 追加実装指示書：API直打ち前提の機能追加

## 0. このMDの目的

この文書は、Chrome拡張 **nico pong** に次の機能を追加するためのAIコーディングエージェント向け実装指示書である。

今回の追加対象：

- マイリストURL / `mylist/12345` から動画を一括読み込みし、リクエスト / ストックへ追加
- 再生中動画情報を生主コメントで投稿
- リクエストタブの自動連続再生を安定化
- ストック → リクエストへの移動 / コピー
- ニコ生コメントから `sm...` / `nm...` / `so...` / ニコ動URLを拾ってリクエスト登録
- `@コテハン` / 名札検出
- NG動画 / 引用不可動画の自動マーキング

重要な前提：

- **DOMでニコ生UIのボタンや入力欄を探して操作しない。**
- 再生制御は、前回成功した **Service Worker経由の quotation API直打ち方式** を継続する。
- ニコ生ページから読むDOMは、番組メタ情報取得用の `#embedded-data` のみとする。
- コメント取得も、画面DOMのコメント欄を読むのではなく、ニコ生のWebSocket / NDGRメッセージサーバーから取得する。
- ニコニコのID/パスワード/Cookie値を扱わない。
- `cookies` permission は追加しない。
- APIトークン / CSRFトークンはローカル保存しない。ログにも出さない。

---

## 1. 既に確定している成功方針

前回の実験により、以下の構成で動画引用再生が成功している。

```text
Side Panel
  ↓
Background Service Worker
  ↓
https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
  ↓
ニコ生で動画引用再生成功
```

引用再生API：

```http
GET    https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
POST   https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
PATCH  https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation/contents
DELETE https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
```

実装ルール：

- API呼び出しはService Worker側で行う。
- `credentials: "include"` を付ける。
- 現在引用再生中かどうかを `GET /quotation` で確認する。
- `404` なら `POST /quotation`。
- 既に引用再生中なら `PATCH /quotation/contents`。
- 停止は `DELETE /quotation`。

---

## 2. nicolivehelperxxから参考にする実装ポイント

New NicoLive Helper / nicolivehelperxx のソースから、以下の方針を参考にする。

### 2.1 引用再生API

`main/main.js` では、`endpointUrl` として以下を使っている。

```js
endpointUrl: "https://services-eapi.spi.nicovideo.jp"
```

引用再生では、次のエンドポイントを使う。

```js
GET    /v1/tools/live/contents/{lvId}/quotation
POST   /v1/tools/live/contents/{lvId}/quotation
PATCH  /v1/tools/live/contents/{lvId}/quotation/contents
DELETE /v1/tools/live/contents/{lvId}/quotation
```

### 2.2 生主コメントAPI

`postCasterComment()` は以下を使っている。

```http
PUT https://live2.nicovideo.jp/unama/api/v3/programs/{lvId}/broadcaster_comment
```

ヘッダ：

```http
X-Public-Api-Token: {embeddedData.site.relive.csrfToken}
```

Bodyは `FormData`：

```text
text={コメント本文}
command={コメントコマンド}
name={名前欄}
isPermanent={true/false}
```

### 2.3 コメント取得

nicolivehelperxx は以下の流れでコメントを受信している。

```text
site.relive.webSocketUrl にWebSocket接続
↓
{"type":"startWatching","data":{}} を送信
↓
messageServer / schedule / ping 等を受信
↓
messageServer の room.viewUri からNDGRコメントストリーム取得
↓
Protobufで ChunkedEntry / ChunkedMessage をdecode
↓
message.chat.content からリスナーコメント取得
```

nico pongでもDOMのコメント欄は読まず、この流れを参考にする。

### 2.4 コメントから動画IDを拾う処理

nicolivehelperxx の `processListenersComment()` は、視聴者コメントから `(sm|nm)\d+` を検出してリクエストに追加している。

nico pongでは `so` とURLにも対応する。

### 2.5 @コテハン処理

nicolivehelperxx の `autoKotehan()` は、コメント末尾の `@名前` / `＠名前` を検出してコテハン登録している。

nico pongでもこれを参考にする。

### 2.6 マイリスト取得

nicolivehelperxx の `libs/nicoapi.js` では、以下が使われている。

```http
https://www.nicovideo.jp/mylist/{mylistId}?rss=2.0&lang=ja-jp&special_chars_decode=1
```

また、自分のマイリスト向けに以下も使われている。

```http
https://nvapi.nicovideo.jp/v1/users/me/mylists/{mylistId}?pageSize=500&page=1
```

nico pongでは、まずRSSを第一候補にし、必要に応じてNVAPIをフォールバックにする。

### 2.7 引用可否チェック

nicolivehelperxx には `isAvailableInNewLive(video_id)` があり、以下のAPIを使っている。

```http
GET https://services-eapi.spi.nicovideo.jp/v1/tools/live/quote/services/video/contents/{videoId}
```

レスポンスの `data.quotable` を引用可否判定に使う。

nico pongでも、動画追加時・再生前にこのチェックを行い、引用不可なら `noLivePlay = true` としてマーキングする。

---

## 3. Manifest修正

`manifest.json` の `host_permissions` を確認し、不足があれば追加する。

```json
{
  "host_permissions": [
    "https://live.nicovideo.jp/*",
    "https://live2.nicovideo.jp/*",
    "https://www.nicovideo.jp/*",
    "https://nvapi.nicovideo.jp/*",
    "https://services-eapi.spi.nicovideo.jp/*"
  ]
}
```

禁止：

```json
"cookies"
```

は追加しない。

---

## 4. 追加・変更する主なファイル

推奨構成：

```text
src/
├─ background/
│  ├─ serviceWorker.ts
│  ├─ nicoLiveQuotationApi.ts        // 既存を拡張
│  ├─ nicoBroadcasterCommentApi.ts   // 追加
│  ├─ nicoMylistApi.ts               // 追加
│  └─ nicoQuoteAvailabilityApi.ts    // 追加
├─ content/
│  └─ nicoliveContentScript.ts       // embedded-data取得のみ
├─ sidepanel/
│  ├─ App.tsx
│  ├─ components/
│  │  ├─ MylistImportForm.tsx        // 追加
│  │  ├─ NowPlayingPanel.tsx         // 拡張
│  │  ├─ PlaybackModeToggle.tsx      // 拡張
│  │  ├─ VideoCard.tsx               // 拡張
│  │  ├─ VideoList.tsx               // 拡張
│  │  ├─ CommentConnectionPanel.tsx  // 追加
│  │  └─ RequestControlPanel.tsx     // 追加
│  ├─ hooks/
│  │  ├─ useAutoPlayback.ts          // 追加/再実装
│  │  ├─ useCommentProvider.ts       // 追加
│  │  ├─ useKotehan.ts               // 追加
│  │  ├─ usePlaybackController.ts    // 拡張
│  │  └─ useVideoLists.ts            // 拡張
│  └─ services/
│     └─ nicoLiveCommentProvider.ts  // 追加
├─ shared/
│  ├─ types.ts                       // 拡張
│  ├─ messaging.ts                   // 拡張
│  ├─ nicoIdExtract.ts               // 拡張
│  ├─ commentParsing.ts              // 追加
│  ├─ templateRenderer.ts            // 追加
│  └─ ngMatcher.ts                   // 追加
└─ storage/
   ├─ videoRepository.ts             // 拡張
   ├─ settingsRepository.ts          // 拡張
   ├─ kotehanRepository.ts           // 追加
   └─ ngRepository.ts                // 追加
```

---

## 5. 型定義追加

`src/shared/types.ts` に以下を追加する。

```ts
export type NicoPongTab = "request" | "stock";

export type PlaybackMode = "manual" | "auto";

export type VideoItemStatus =
  | "queued"
  | "checking"
  | "ready"
  | "playing"
  | "played"
  | "interrupted"
  | "skipped"
  | "ng"
  | "no_live_play"
  | "error";

export type PlaybackSource = "request" | "stock" | "manual_input";

export type RequestAcceptMode = "accept" | "stop";

export type ImportTarget = "request" | "stock";

export type MylistImportResult = {
  ok: boolean;
  mylistId: string;
  total: number;
  imported: number;
  duplicated: number;
  failed: number;
  videoIds: string[];
  errorMessage?: string;
};

export type BroadcasterCommentTemplate = {
  id: string;
  name: string;
  text: string;
  command: string;
  isPermanent: boolean;
  autoPostOnPlay: boolean;
};

export type NicoLiveComment = {
  id: string;
  no: number;
  userId: string;
  name?: string;
  text: string;
  textNotag: string;
  premium?: number;
  date: number;
  isOperatorComment: boolean;
  isOwnPost?: boolean;
};

export type CommentUserProfile = {
  userId: string;
  displayName?: string;
  nameSource: "nametag" | "at_comment" | "manual" | "user_id";
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  playedRequestCount: number;
  ng: boolean;
  memo?: string;
};

export type NgRuleSet = {
  videoIds: string[];
  ownerIds: string[];
  userIds: string[];
  titleWords: string[];
  tagWords: string[];
  descriptionWords: string[];
};
```

既存の `NicoPongVideo` に以下を追加・確認する。

```ts
export type NicoPongVideo = {
  id: string;
  videoId: string;
  url: string;
  title: string;
  thumbnailUrl?: string;
  ownerName?: string;
  ownerId?: string;
  displayAuthorName?: string;
  viewCount?: number;
  commentCount?: number;
  mylistCount?: number;
  likeCount?: number;
  durationSec?: number;
  tags: string[];
  lockedTags?: string[];

  addedTo: NicoPongTab;
  order: number;
  status: VideoItemStatus;

  noLivePlay?: boolean;
  quotable?: boolean;
  ngReason?: string;

  requestUserId?: string;
  requestUserName?: string;
  requestCommentNo?: number;

  sourceType?: "manual" | "comment" | "mylist" | "stock_move" | "stock_copy";
  sourceMylistId?: string;

  addedAt: string;
  updatedAt: string;
  lastPlayedAt?: string;
  playCount?: number;
};
```

---

## 6. マイリストURL一括読み込み

### 6.1 入力対応形式

手動入力欄は、動画IDだけでなくマイリストURLも受け付ける。

対応例：

```text
mylist/12345
12345  ※「マイリスト追加モード」時のみ
https://www.nicovideo.jp/mylist/12345
https://www.nicovideo.jp/user/999999/mylist/12345
```

抽出関数を作る。

```ts
export function extractNicoMylistId(input: string): string | null {
  const trimmed = input.trim();

  const direct = trimmed.match(/^mylist\/(\d+)$/i);
  if (direct) return direct[1];

  const url = trimmed.match(/nicovideo\.jp\/(?:user\/\d+\/)?mylist\/(\d+)/i);
  if (url) return url[1];

  return null;
}
```

### 6.2 UI

Side Panel上部または各タブに以下を追加する。

```text
動画ID / URL / マイリストURL [__________________] [追加]
[ ] マイリストURLとして読み込む
追加先: 現在のタブ（リクエスト / ストック）
```

もしくは専用フォーム：

```text
マイリスト一括追加
[ mylist/12345________________ ] [現在のタブへ一括追加]
```

### 6.3 API取得方針

`src/background/nicoMylistApi.ts` を追加する。

第一候補：RSS

```http
GET https://www.nicovideo.jp/mylist/{mylistId}?rss=2.0&lang=ja-jp&special_chars_decode=1
```

RSSから `<item>` の `<link>` または `<guid>` を見て `sm...` / `nm...` / `so...` を抽出する。

第二候補：自分のマイリスト向けNVAPI

```http
GET https://nvapi.nicovideo.jp/v1/users/me/mylists/{mylistId}?pageSize=500&page=1
```

ヘッダ：

```http
X-Frontend-Id: 6
X-Frontend-Version: 0
X-Niconico-Language: ja-jp
```

実装ルール：

- API呼び出しはService Workerで行う。
- `credentials: "include"` を付ける。
- RSSで成功したらRSSを採用。
- RSSで失敗したらNVAPIを試す。
- 取得した動画IDは順序を維持する。
- 重複はスキップする。
- 取得後、各動画について既存の動画情報取得処理を呼ぶ。
- 可能なら引用可否チェックも実施する。
- 進捗表示を行う。

### 6.4 一括追加時の進捗表示

```text
マイリスト読み込み中: 12 / 80
追加済み: 10
重複スキップ: 2
取得失敗: 0
```

### 6.5 追加先

現在アクティブなタブへ追加する。

- リクエストタブがアクティブ → `addedTo: "request"`
- ストックタブがアクティブ → `addedTo: "stock"`

### 6.6 受け入れ基準

- `mylist/12345` を入力して一括読み込みできる。
- `https://www.nicovideo.jp/mylist/12345` を入力して一括読み込みできる。
- リクエストタブで読み込んだ場合、動画がリクエストに並ぶ。
- ストックタブで読み込んだ場合、動画がストックに並ぶ。
- 重複はスキップされる。
- 読み込み中に進捗が出る。

---

## 7. 再生中動画情報を生主コメントで投稿

### 7.1 API

`src/background/nicoBroadcasterCommentApi.ts` を追加する。

エンドポイント：

```http
PUT https://live2.nicovideo.jp/unama/api/v3/programs/{lvId}/broadcaster_comment
```

ヘッダ：

```http
X-Public-Api-Token: {csrfToken}
```

Body：

```ts
const form = new FormData();
form.append("text", text);
form.append("command", command || "");
form.append("name", name || "");
form.append("isPermanent", String(isPermanent));
```

`csrfToken` は `#embedded-data` の `site.relive.csrfToken` から取得する。

重要：

- `csrfToken` は保存しない。
- `csrfToken` はログに出さない。
- Side PanelからService Workerへ投稿要求を送る時に、一時的に渡すだけにする。
- 可能なら、Service WorkerではなくContent Scriptから `GET_EMBEDDED_DATA` で毎回取得する。

### 7.2 メッセージング

```ts
export type PostBroadcasterCommentRequest = {
  lvId: string;
  csrfToken: string;
  text: string;
  command?: string;
  name?: string;
  isPermanent?: boolean;
};
```

```ts
{ type: "POST_BROADCASTER_COMMENT", payload: PostBroadcasterCommentRequest }
```

### 7.3 テンプレート

デフォルトテンプレート：

```text
♪ 再生中: {title} / {displayAuthorName} / 再生:{viewCount} コメ:{commentCount} マイリス:{mylistCount} いいね:{likeCount} {url}
```

変数：

```text
{videoId}
{url}
{title}
{ownerName}
{displayAuthorName}
{viewCount}
{commentCount}
{mylistCount}
{likeCount}
{duration}
{requestUserName}
{requestCommentNo}
{tags}
```

`src/shared/templateRenderer.ts` を追加する。

### 7.4 文字数制限

主コメは長すぎると失敗する可能性がある。実装では以下のどちらかを行う。

初期実装：

- 80文字を超える場合、警告を表示して投稿しない。

推奨実装：

- 75文字程度で複数行/複数コメントに分割し、1.5〜2.5秒間隔で送信する。
- ただしスパム防止のため、初期値は「分割投稿OFF」。

### 7.5 自動投稿タイミング

設定を追加する。

```ts
export type CommentSettings = {
  autoPostVideoInfoOnPlay: boolean;
  postDelayMs: number;
  defaultCommand: string;
  defaultName: string;
  defaultIsPermanent: boolean;
};
```

初期値：

```ts
autoPostVideoInfoOnPlay: true
postDelayMs: 500
defaultCommand: ""
defaultName: ""
defaultIsPermanent: false
```

再生成功後に投稿する。

```text
再生API成功
↓
NowPlaying更新
↓
postDelayMs待機
↓
主コメ投稿
```

### 7.6 手動投稿ボタン

NowPlayingPanelに追加：

```text
[動画情報を主コメ投稿]
```

### 7.7 エラー処理

APIレスポンスが失敗した場合：

```text
主コメ投稿に失敗しました: {meta.errorMessage || HTTP status}
```

`リクエスト間隔が短` のようなエラーが出た場合、nicolivehelperxxと同様にバックオフして最大3回まで再試行する。

---

## 8. リクエストタブの自動連続再生安定化

現在の問題：

- リクエストタブに入っている動画が自動再生されない。

今回の必須仕様：

- **自動再生ONのとき、リクエストタブの動画は上から順に自動再生される。**
- ストックタブは自動再生対象にしない。
- 手動再生は常に優先。

### 8.1 状態管理

`useAutoPlayback.ts` を作る。

```ts
export type AutoPlaybackState = {
  enabled: boolean;
  running: boolean;
  locked: boolean;
  timerId?: number;
  lastStartedVideoId?: string;
  lastError?: string;
};
```

### 8.2 自動再生開始条件

以下の場合、自動再生を開始する。

- 再生モードが `auto`
- 現在再生中がない、または `idle`
- リクエストタブに再生可能な動画が1本以上ある
- 自動再生ロック中ではない

発火タイミング：

- 自動再生ONに切り替えた直後
- リクエストタブに動画が追加された直後
- 1本の動画が再生終了扱いになった直後
- エラー動画をスキップした直後

### 8.3 次動画選択

```ts
export function findNextPlayableRequest(videos: NicoPongVideo[]): NicoPongVideo | null {
  return [...videos]
    .filter((v) => v.addedTo === "request")
    .sort((a, b) => a.order - b.order)
    .find((v) => {
      if (v.status === "played") return false;
      if (v.status === "skipped") return false;
      if (v.status === "ng") return false;
      if (v.status === "no_live_play") return false;
      if (v.noLivePlay === true) return false;
      if (v.quotable === false) return false;
      return true;
    }) ?? null;
}
```

### 8.4 再生成功時

```text
status = playing
NowPlaying更新
主コメ自動投稿（設定ONなら）
durationSec + autoplayIntervalSec で次動画タイマー設定
```

`durationSec` が不明な場合：

- 自動次動画には進まない。
- UIに「再生時間不明のため自動次動画に進みません」と表示する。
- 手動で「再生済みにして次へ」ボタンを出す。

### 8.5 再生終了扱い

タイマーが発火したら：

```text
現在動画 status = played
lastPlayedAt更新
playCount加算
次のリクエスト動画を再生
```

### 8.6 再生失敗時

引用APIが失敗した場合：

- `status = error`
- エラー文言が「引用再生できない動画です」等なら `noLivePlay = true`, `status = no_live_play`
- 自動再生ONなら2.5秒後に次動画へ進む
- 連続エラーが5件以上続いたら自動再生を停止し、エラー表示する

### 8.7 手動再生割り込み

動画カードの「今すぐ再生」が押された場合：

- 自動再生タイマーをキャンセル
- 現在再生中動画があれば `interrupted`
- 押された動画を即API再生
- 手動再生した動画がリクエストタブ内の動画なら、完了後は `played`
- 自動再生ONなら、手動再生動画の終了後に次のリクエストへ戻る

### 8.8 NowPlayingPanel追加ボタン

```text
[停止]
[次へ]
[再生済みにして次へ]
[動画情報を主コメ投稿]
```

`次へ`：

- 現在動画を `skipped` にする
- `DELETE /quotation` は必須ではない。次動画を `PATCH` で差し替えてよい。

`停止`：

- `DELETE /quotation`
- 自動再生タイマー停止
- playback stateを `idle`

---

## 9. ストック → リクエスト移動 / コピー

### 9.1 UI

ストックタブの各動画カードに追加：

```text
[リクエストへコピー]
[リクエストへ移動]
```

### 9.2 コピー仕様

- ストックには残す。
- リクエストタブ末尾に同じ動画を追加。
- 内部IDは新規UUID。
- `sourceType = "stock_copy"`
- `status = "queued"`
- `lastPlayedAt`, `playCount` は引き継がない。

### 9.3 移動仕様

- ストックから削除。
- リクエストタブ末尾に追加。
- 内部IDは同じでもよいが、実装を単純にするなら新規UUIDでもよい。
- `sourceType = "stock_move"`
- `status = "queued"`

### 9.4 重複チェック

設定を追加：

```ts
preventDuplicateInRequest: true
```

有効時：

- 既にリクエストタブに同じ `videoId` があれば追加しない。
- UIに「既にリクエストにあります」と表示。

---

## 10. コメントから動画IDを拾ってリクエスト登録

### 10.1 コメント取得方針

DOMのコメント欄を読まない。

以下のAPI/通信を使う。

```text
embeddedData.site.relive.webSocketUrl
↓
WebSocket接続
↓
{"type":"startWatching","data":{}} 送信
↓
messageServerを受信
↓
room.viewUri からNDGRコメントストリーム取得
↓
コメントを解析
```

実装場所：

- Side Panelが開いている間だけ動けばよいので、初期実装は `src/sidepanel/services/nicoLiveCommentProvider.ts` でよい。
- Service Workerはスリープするため、長時間コメント接続を維持する用途には向かない。
- 将来的に安定化する場合は offscreen document を検討する。

### 10.2 必要ライブラリ

NDGRのProtobufをdecodeするため、以下のどちらかを採用する。

推奨：

```bash
npm install protobufjs
```

実装方法：

- 必要な `.proto` 定義を `src/proto/` に置く。
- `protobufjs` で `dwango.nicolive.chat.service.edge.ChunkedEntry` と `ChunkedMessage` をdecodeする。

簡易代替：

- 既にプロジェクトにNDGRClient相当の実装がある場合、それを移植してよい。

### 10.3 コメント正規化

NDGRメッセージから以下へ正規化する。

```ts
const chat: NicoLiveComment = {
  id: `${no}-${date}-${userId}`,
  no,
  userId: user_message?.hashedUserId || msg?.meta?.id || "0",
  name: user_message?.name || "",
  text: op_message || user_message?.content || "",
  textNotag: op_message || user_message?.content || "",
  premium: op_message ? 2 : 0,
  date: msg?.meta?.at?.seconds ?? Math.floor(Date.now() / 1000),
  isOperatorComment: Boolean(op_message),
};
```

### 10.4 動画ID抽出

`src/shared/commentParsing.ts` に実装。

```ts
export function extractVideoIdsFromComment(text: string): string[] {
  const ids = new Set<string>();

  const patterns = [
    /\b((?:sm|nm|so)\d+)\b/gi,
    /nicovideo\.jp\/watch\/((?:sm|nm|so)\d+)/gi,
    /nico\.ms\/((?:sm|nm|so)\d+)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      ids.add(match[1].toLowerCase());
    }
  }

  return [...ids];
}
```

### 10.5 リクエスト登録ルール

コメントから動画IDを拾ったら：

1. リクエスト受付ONか確認
2. コメント投稿者がNGユーザーでないか確認
3. 動画IDがNG動画でないか確認
4. 重複チェック
5. 動画情報取得
6. 引用可否チェック
7. リクエストタブ末尾に追加
8. 必要なら受付主コメを投稿

設定：

```ts
requestAcceptMode: "accept" | "stop"
autoAcceptCommentRequests: true
preventDuplicateInRequest: true
maxRequestsPerUser: 3
```

初期値：

```ts
requestAcceptMode: "accept"
autoAcceptCommentRequests: true
preventDuplicateInRequest: true
maxRequestsPerUser: 3
```

### 10.6 UI

コメント接続パネル：

```text
コメント接続: 未接続 / 接続中 / 接続済み / エラー
[コメント接続開始] [停止]
リクエスト受付: ON / OFF
コメントから自動追加: ON / OFF
```

リクエスト追加時に表示：

```text
C#123 @コテハン さんのリクエスト: sm12345678 を追加しました
```

---

## 11. @コテハン / 名札検出

### 11.1 優先順位

ユーザー表示名の優先順位：

```text
1. 手動設定名
2. NDGR user_message.name 由来の名札
3. コメント末尾 @コテハン
4. userId
```

### 11.2 @コテハン抽出

```ts
export function extractKotehan(text: string): string | null {
  const match = text.match(/[@＠]([^0-9０-９\s@＠][^\s@＠]{0,31})$/);
  if (!match) return null;

  const name = match[1].trim();

  const blocked = new Set([
    "初見",
    "確認",
    "アンケート",
    "削除",
    "代理",
    "○",
    "×",
    "△",
    "□",
    "◎",
  ]);

  if (blocked.has(name)) return null;
  return name;
}
```

### 11.3 保存

`kotehanRepository.ts` を追加。

```ts
export async function upsertUserProfile(profile: CommentUserProfile): Promise<void>;
export async function getUserProfile(userId: string): Promise<CommentUserProfile | null>;
export async function incrementRequestCount(userId: string): Promise<void>;
```

### 11.4 リクエスト動画への反映

コメント由来で追加した動画には以下を保存する。

```ts
requestUserId: comment.userId
requestUserName: resolvedDisplayName
requestCommentNo: comment.no
sourceType: "comment"
```

動画カードに表示：

```text
リク主: @hogehoge / C#123
```

---

## 12. NG動画 / 引用不可動画の自動マーキング

### 12.1 ローカルNG

`ngRepository.ts` を追加する。

NG対象：

- 動画ID
- 投稿者ID
- リク主ID
- タイトルNGワード
- タグNGワード
- 説明文NGワード

```ts
export async function getNgRules(): Promise<NgRuleSet>;
export async function isNgVideo(video: NicoPongVideo): Promise<{ ng: boolean; reason?: string }>;
export async function isNgRequestUser(userId: string): Promise<{ ng: boolean; reason?: string }>;
```

### 12.2 引用可否チェック

`src/background/nicoQuoteAvailabilityApi.ts` を追加。

```http
GET https://services-eapi.spi.nicovideo.jp/v1/tools/live/quote/services/video/contents/{videoId}
```

期待レスポンス：

```ts
res.data.quotable
```

実装例：

```ts
export async function checkQuoteAvailability(videoId: string): Promise<{
  ok: boolean;
  quotable?: boolean;
  errorMessage?: string;
}> {
  const response = await fetch(
    `https://services-eapi.spi.nicovideo.jp/v1/tools/live/quote/services/video/contents/${videoId}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-From-NicoPong-Extension": "1",
      },
    }
  );

  const text = await response.text();

  if (!response.ok) {
    return { ok: false, quotable: false, errorMessage: `HTTP ${response.status}` };
  }

  const json = JSON.parse(text);
  return {
    ok: true,
    quotable: Boolean(json?.data?.quotable),
  };
}
```

### 12.3 チェックタイミング

- 動画手動追加時
- マイリスト一括追加時
- コメントリクエスト追加時
- 再生直前
- 引用再生API失敗時

### 12.4 マーキング

引用不可：

```ts
video.noLivePlay = true;
video.quotable = false;
video.status = "no_live_play";
video.ngReason = "引用再生できない可能性があります";
```

NG：

```ts
video.status = "ng";
video.ngReason = "NG動画IDに一致";
```

UI：

```text
[引用不可]
[NG: 理由]
```

自動再生では必ずスキップする。

---

## 13. メッセージング追加

`src/shared/messaging.ts` に追加。

```ts
export type NicoPongMessage =
  | { type: "IMPORT_MYLIST"; payload: { mylistId: string; target: ImportTarget } }
  | { type: "IMPORT_MYLIST_RESULT"; payload: MylistImportResult }
  | { type: "POST_BROADCASTER_COMMENT"; payload: PostBroadcasterCommentRequest }
  | { type: "POST_BROADCASTER_COMMENT_RESULT"; payload: { ok: boolean; errorMessage?: string } }
  | { type: "CHECK_QUOTE_AVAILABILITY"; payload: { videoId: string } }
  | { type: "CHECK_QUOTE_AVAILABILITY_RESULT"; payload: { ok: boolean; quotable?: boolean; errorMessage?: string } }
  | { type: "GET_EMBEDDED_DATA" }
  | { type: "GET_EMBEDDED_DATA_RESULT"; payload: NicoLiveEmbeddedData };
```

---

## 14. 実装順序

AIエージェントは以下の順で実装する。

### Task 1: APIクライアント整理

- 既存のquotation APIを `background/nicoLiveQuotationApi.ts` に整理
- `nicoBroadcasterCommentApi.ts` 追加
- `nicoMylistApi.ts` 追加
- `nicoQuoteAvailabilityApi.ts` 追加
- すべてService Worker経由で呼ぶ

### Task 2: 自動連続再生の修正

- `useAutoPlayback.ts` を実装
- 自動再生ONでリクエストタブ上から順に再生
- `durationSec` タイマーで次動画へ
- エラー時スキップ
- 手動割り込み対応

### Task 3: 主コメ投稿

- NowPlayingPanelに「動画情報を主コメ投稿」追加
- 再生成功時の自動投稿追加
- テンプレート置換実装
- CSRFトークンはembedded-dataから都度取得

### Task 4: ストック→リクエスト

- コピー/移動ボタン追加
- リクエスト末尾へ追加
- 重複チェック

### Task 5: マイリスト一括追加

- URL/ID抽出
- RSS取得
- NVAPIフォールバック
- 動画情報取得
- 引用可否チェック
- 進捗UI

### Task 6: コメント取得

- `NicoLiveCommentProvider` 実装
- relive WebSocket接続
- `startWatching` 送信
- messageServerからNDGR取得
- protobuf decode
- コメント正規化

### Task 7: コメントリクエスト / コテハン

- `sm/nm/so` / URL抽出
- `@コテハン` 検出
- 名札優先
- リクエストへ追加
- リク主情報保存

### Task 8: NG / 引用不可マーキング

- ローカルNGチェック
- 引用可否APIチェック
- 再生失敗時マーキング
- 自動再生スキップ

---

## 15. 受け入れ基準

### 15.1 マイリスト

- `mylist/12345` から動画一覧を取得できる。
- マイリストURLから動画一覧を取得できる。
- 現在タブがリクエストならリクエストへ入る。
- 現在タブがストックならストックへ入る。
- 重複はスキップされる。
- 進捗表示が出る。

### 15.2 主コメ投稿

- NowPlayingの動画情報を主コメ投稿できる。
- 再生成功時に自動投稿できる。
- `{title}` 等のテンプレ変数が置換される。
- 投稿失敗時にエラーが表示される。
- CSRFトークンを保存/ログ出力していない。

### 15.3 自動再生

- 自動再生ONにすると、リクエストタブ上から順に再生される。
- 1本目終了後、次の動画へ進む。
- 引用不可/NG/エラー動画はスキップされる。
- 手動再生は自動再生より優先される。
- 連続エラー時に無限ループしない。

### 15.4 ストック→リクエスト

- ストック動画をリクエストへコピーできる。
- ストック動画をリクエストへ移動できる。
- リクエスト末尾に追加される。
- 重複設定が効く。

### 15.5 コメントリクエスト

- コメント接続ができる。
- コメント内の `sm...` を検出してリクエストへ追加できる。
- ニコ動URLも検出できる。
- リク主名とコメント番号が保存される。
- 受付ON/OFFが効く。

### 15.6 コテハン/名札

- `user_message.name` があれば名札として表示される。
- コメント末尾 `@名前` が検出される。
- 同じuserIdの以後のリクエストに名前が反映される。

### 15.7 NG/引用不可

- NG動画IDは自動で `ng` になる。
- 引用不可APIで `quotable=false` の動画は `no_live_play` になる。
- 引用API失敗時も引用不可としてマーキングされる。
- 自動再生でスキップされる。

### 15.8 セキュリティ

- `cookies` permissionを追加していない。
- ID/パスワードを扱っていない。
- Cookie値を読んでいない。
- CSRFトークンを保存していない。
- DOMのニコ生操作UIを探索していない。
- `npm run build` が通る。

---

## 16. AIへのプロンプト例

以下をそのままAIコーディングエージェントへ渡す。

```text
nico pong に v0.2 機能を追加してください。
仕様は docs/nico-pong-v0.2-feature-additions-api-direct.md に従ってください。

重要な前提：
- ニコ生UIのボタンや入力欄をDOM探索して操作しないでください。
- 動画再生は前回成功した Service Worker 経由の quotation API 方式を継続してください。
- コメント取得もDOMコメント欄を読まず、embedded-data の relive WebSocket / NDGRコメントストリームを使ってください。
- API呼び出しは原則Service Workerで実行してください。
- cookies permissionは追加しないでください。
- Cookie値、ID、パスワードは扱わないでください。
- csrfTokenは保存・ログ出力しないでください。

実装対象：
1. マイリストURL / mylist/12345 一括読み込み
2. 再生中動画情報の生主コメント投稿
3. リクエストタブ上から順の自動連続再生
4. ストック→リクエストへのコピー/移動
5. コメントからsm/nm/so/URLを拾ってリクエスト登録
6. @コテハン / 名札検出
7. NG動画 / 引用不可動画の自動マーキング

優先順位：
1. 自動連続再生の修正
2. 生主コメント投稿
3. ストック→リクエスト
4. マイリスト一括追加
5. NG/引用不可チェック
6. コメント取得
7. コテハン/名札

実装後、以下を報告してください。
- 変更ファイル
- 追加したAPIクライアント
- 自動再生テスト結果
- 生主コメント投稿テスト結果
- マイリスト一括読み込みテスト結果
- コメントリクエストテスト結果
- 未解決TODO
```

---

## 17. 補足：今回の最重要修正

今回もっとも重要なのは以下。

```text
リクエストタブに入っている動画は、
自動再生ONなら上から順に必ず再生する。
```

そのため、実装では次の条件を必ず満たすこと。

- 自動再生ONにした瞬間、現在再生中でなければ先頭の再生可能動画を再生する。
- 動画追加時、自動再生ONかつidleなら即再生開始する。
- 1本再生終了扱いになったら、次の動画へ進む。
- `noLivePlay` / `ng` / `error` はスキップする。
- 手動再生が押されたら、手動再生を優先する。
- 自動再生タイマーは多重起動させない。

---

## 18. README追記

READMEに以下を追記する。

```text
nico pong は、ニコニコ生放送の番組ページ上で、ログイン済みブラウザセッションを利用して動画引用再生・生主コメント投稿・コメントリクエスト受付を支援します。
ニコニコのID・パスワード・Cookie値は収集しません。
動画リスト、設定、コテハン情報、NG情報はブラウザ内に保存されます。
ニコニコ側の内部API仕様変更により、一部機能が動作しなくなる可能性があります。
```
