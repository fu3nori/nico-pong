# nico pong v0.2.1 FIX指示書：コメントリクエスト受付・作者名付き生主コメント

## 0. このMDの目的

この文書は、Chrome拡張 **nico pong v0.2** の実装漏れを修正するためのAIコーディング向け指示書である。  
バージョンは **v0.2.1** とする。

今回修正する不具合は以下の2点。

1. 視聴者がコメントで `sm9` などを投稿しても、nico pong の **リクエストタブ最下部に動画情報が追加されない**
2. 生主コメントで動画タイトルとURLは表示されるが、**作者名が取得・表示されない**

重要な前提：

- 前回と同様、ニコ生UIのDOMクリックやDOM表示内容に依存しない。
- ニコ生との通信は、可能な限り **API / WebSocket / message server** ベースで行う。
- New NicoLive Helper（nicolivehelperxx）の実装を参考にする。
- DOMを使うのは `#embedded-data` から初期情報を読む用途までに限定する。
- 動画再生は既に成功している **Service Worker → quotation API** 方式を維持する。
- Cookieを直接読まない。
- `cookies` permissionを追加しない。
- ID/パスワードを扱わない。

---

## 1. 参照するニコヘル実装ポイント

New NicoLive Helper では、以下の設計が使われている。

### 1.1 コメントから動画IDを拾ってリクエスト化

`processListenersComment(chat)` で視聴者コメント本文から動画IDを検出し、受付中なら `NicoLiveRequest.addRequest(video_id, chat.comment_no, chat.user_id, ...)` を呼ぶ。

nico pong でも同じ考え方にする。

```text
コメント受信
↓
視聴者コメントだけ処理
↓
本文から sm/nm/so 動画IDまたはURLを抽出
↓
動画情報取得
↓
リクエストタブ最下部へ追加
```

### 1.2 @コテハン検出

ニコヘルではコメント末尾の `@名前` / `＠名前` を検出し、コテハンとして保存している。

nico pong でも以下を行う。

```text
コメント本文末尾の @hogehoge / ＠hogehoge を検出
↓
userId に displayName として紐付け
↓
以後、そのユーザーのリクエスト者名として表示
```

### 1.3 生主コメント投稿

ニコヘルでは、主コメント投稿に以下のAPIを使っている。

```http
PUT https://live2.nicovideo.jp/unama/api/v3/programs/{lvId}/broadcaster_comment
X-Public-Api-Token: {csrfToken}
FormData:
  text
  command
  name
  isPermanent
```

nico pong では既にタイトルとURL投稿が動いているため、今回は **作者名変数の生成とテンプレ差し込み** を修正する。

### 1.4 作者名推定

ニコヘルではタグからP名を推定する `isPName()` / `getPName()` がある。  
nico pong ではより単純に、以下の優先順で作者表示名を決める。

```text
1. 手動上書き作者名
2. ロック済みタグの「○○P」
3. ロック済みタグの「○○作品」
4. ロック済みタグの「○○の人」
5. 通常タグの「○○P」
6. 通常タグの「○○作品」
7. 通常タグの「○○の人」
8. 投稿者アカウント名 / チャンネル名
9. 不明
```

---

## 2. 今回の完成条件

v0.2.1 は以下を満たしたら完成。

### 2.1 コメントリクエスト

- 視聴者が `sm9` とコメントすると、リクエストタブの最下部に動画情報が追加される
- `https://www.nicovideo.jp/watch/sm9` でも追加される
- `https://nico.ms/sm9` でも追加される
- `nm...` / `so...` も抽出対象にする
- 既に同じ動画がリクエストタブにある場合は重複追加しない
- ストックタブに同じ動画がある場合は、リクエストタブへの追加は許可してよい。ただしUI上に「ストック済み」と表示できるなら表示する
- 追加位置は必ずリクエストタブの一番下
- 動画情報取得に失敗した場合はリクエストタブに追加せず、エラーをログ/通知に出す
- 引用不可動画は追加してもよいが、`引用不可` マークを付け、自動再生対象から外す
- 自分の生主コメントや運営コメントはリクエストとして扱わない
- リクエスト受付ON/OFF設定がOFFなら追加しない

### 2.2 @コテハン/名札

- コメントに名札 `name` がある場合、リクエスト者表示名として優先する
- コメント末尾に `@hogehoge` / `＠hogehoge` がある場合、ユーザーに紐付けて保存する
- 以後そのユーザーの表示名として使う
- `@初見`, `@確認`, `@削除`, `@代理`, `@○`, `@×`, `@△`, `@□`, `@◎` はコテハン登録しない
- リクエストブロックに `リク主: hogehoge` を表示する

### 2.3 生主コメントの作者名

- 再生開始時の生主コメントに作者名を表示する
- 作者名は `displayAuthorName` を使う
- `displayAuthorName` がなければ、タグから再推定する
- それでもなければ投稿者アカウント名/チャンネル名を使う
- それでもなければ `不明` と表示する
- `hogehogeP`, `hogehoge作品`, `hogehogeの人` 形式のタグがあれば、投稿者アカウント名より優先する
- 生主コメントテンプレート変数 `{displayAuthorName}` / `{author}` / `{ownerName}` を正しく展開する

---

## 3. 追加・変更するファイル

既存構成に合わせて調整してよいが、最低限以下を追加/変更する。

```text
src/
├─ background/
│  ├─ serviceWorker.ts                  // PLAY_VIDEO成功後の自動再生・主コメ連携を確認
│  ├─ nicoLiveQuotationApi.ts           // 既存維持
│  └─ broadcasterCommentApi.ts          // 既にあれば修正、なければ追加
├─ content/
│  ├─ nicoliveContentScript.ts          // embedded-data取得だけ維持
│  └─ nicoLiveEmbeddedData.ts           // あれば修正
├─ sidepanel/
│  ├─ hooks/
│  │  ├─ useCommentRequestWatcher.ts    // 追加
│  │  ├─ usePlaybackController.ts       // 作者名付き主コメと自動再生連携を修正
│  │  ├─ useVideoLists.ts               // request末尾追加を修正
│  │  └─ useKotehanMap.ts               // 追加
│  ├─ components/
│  │  ├─ VideoCard.tsx                  // リク主・作者名表示を修正
│  │  ├─ RequestTab.tsx                 // 受付ON/OFF表示
│  │  └─ SettingsTab.tsx                // 必要なら受付ON/OFFとテンプレ追加
├─ shared/
│  ├─ types.ts                          // 型追加
│  ├─ nicoVideoId.ts                    // コメント/URL抽出強化
│  ├─ authorName.ts                     // 作者名推定を強化
│  ├─ broadcasterCommentTemplate.ts     // 追加/修正
│  └─ nicoCommentTypes.ts               // 追加
└─ storage/
   ├─ videoRepository.ts                // appendRequestVideo, status更新
   ├─ settingsRepository.ts             // requestEnabled, commentTemplate
   └─ kotehanRepository.ts              // 追加
```

---

## 4. 型定義追加

`src/shared/types.ts` に追加する。

```ts
export type RequestSource = "comment" | "manual" | "mylist" | "stock";

export type NicoPongComment = {
  id: string;
  lvId: string;
  no: number;
  userId: string;
  userName?: string;       // 名札、またはAPI上のname
  text: string;
  textNotag: string;
  premium?: number;
  postedAt: string;
  isBroadcasterComment: boolean;
  isOperatorComment: boolean;
  isListenerComment: boolean;
};

export type RequestAddResult =
  | {
      ok: true;
      video: NicoPongVideo;
      reason: "added";
    }
  | {
      ok: false;
      videoId?: string;
      reason:
        | "duplicated"
        | "request_disabled"
        | "fetch_failed"
        | "ng_video"
        | "invalid_video_id"
        | "broadcaster_comment_ignored"
        | "operator_comment_ignored";
      message: string;
    };

export type KotehanProfile = {
  userId: string;
  displayName: string;
  source: "nametag" | "at_comment" | "manual";
  firstSeenAt: string;
  lastSeenAt: string;
};
```

既存 `NicoPongVideo` に以下がなければ追加する。

```ts
export type NicoPongVideo = {
  // 既存...

  requestSource?: RequestSource;
  requestCommentNo?: number;
  requestUserId?: string;
  requestUserName?: string;

  ownerName?: string;
  ownerId?: string;
  displayAuthorName?: string;
  authorNameSource?: AuthorNameSource;

  noLivePlay?: boolean;
  quotable?: boolean;
};
```

---

## 5. コメント受信実装

## 5.1 方針

コメント受信はDOM監視で行わない。  
ニコヘルの構成を参考に、ニコ生の視聴WebSocketと message server から取得する。

実装場所は **Side Panel側** を推奨する。

理由：

- Side Panelは開いている間持続する
- MV3 Service Workerはスリープする可能性がある
- コメント監視のような長時間接続はSide PanelまたはOffscreen Documentが向く
- API再生はService Worker、コメント監視はSide Panel、という責務分離にする

構成：

```text
Side Panel
  ↓
Content Scriptから embedded-data を取得
  ↓
site.relive.webSocketUrl を取得
  ↓
WebSocketで startWatching
  ↓
messageServer 情報を受け取る
  ↓
NDGR / message stream を購読
  ↓
コメントをNicoPongCommentへ正規化
  ↓
sm/nm/so抽出
  ↓
リクエストタブ最下部へ追加
```

### 5.2 embedded-dataから必要情報を取得

`#embedded-data` の `data-props` から以下を取得する。

```ts
type EmbeddedDataForComments = {
  program?: {
    nicoliveProgramId?: string;
    title?: string;
  };
  site?: {
    frontendId?: number | string;
    relive?: {
      webSocketUrl?: string;
      csrfToken?: string;
    };
  };
  user?: {
    isBroadcaster?: boolean;
    isOperator?: boolean;
  };
};
```

`csrfToken` は生主コメント投稿用に使うが、保存しない。  
メモリ上だけに保持する。

### 5.3 WebSocket startWatching

```ts
const wsUrl = `${embedded.site.relive.webSocketUrl}&frontend_id=${embedded.site.frontendId}`;
const ws = new WebSocket(wsUrl);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    type: "startWatching",
    data: {}
  }));
});
```

受信処理：

```ts
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case "messageServer":
      connectMessageServer(message.data);
      break;

    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;

    case "seat":
      startKeepSeat(message.data.keepIntervalSec);
      break;

    case "schedule":
      updateSchedule(message.data);
      break;
  }
});
```

`keepSeat`：

```ts
function startKeepSeat(intervalSec: number) {
  clearInterval(keepSeatTimer);
  keepSeatTimer = window.setInterval(() => {
    ws.send(JSON.stringify({ type: "keepSeat" }));
  }, intervalSec * 1000);
}
```

---

## 6. NDGR / message server購読

### 6.1 実装の現実方針

ニコヘルでは `room.viewUri` から protobuf の chunked message を取得している。  
nico pong でもこの方式を使う。

ただしAIエージェントが一度に完全実装できない可能性があるため、以下の段階実装にする。

### Phase A：コメント受信基盤

- WebSocketで `messageServer` まで受信する
- `room.viewUri` をログ表示する
- `messageServer` を受け取れたらUIに「コメントサーバー接続情報取得済み」と表示する

### Phase B：NDGRデコード

- `protobufjs` を導入する
- 必要なproto定義を `src/shared/proto/` に置く
- `ChunkedEntry` / `ChunkedMessage` をdecodeする
- `message.chat` と `state.marquee.display.operatorComment.content` を拾う
- `NicoPongComment` に正規化する

### Phase C：リクエスト追加

- `NicoPongComment` を `handleIncomingComment(comment)` に渡す
- 視聴者コメントだけ動画ID抽出
- リクエストタブへ追加

### 6.2 CommentProviderインターフェース

```ts
export interface CommentProvider {
  connect(params: {
    lvId: string;
    webSocketUrl: string;
    frontendId: string | number;
  }): Promise<void>;

  disconnect(): void;

  onComment(callback: (comment: NicoPongComment) => void): void;

  getStatus(): CommentProviderStatus;
}

export type CommentProviderStatus =
  | "idle"
  | "connecting"
  | "watching_connected"
  | "message_server_received"
  | "comment_stream_connected"
  | "error";
```

### 6.3 コメント正規化

NDGRメッセージから以下を取り出す。

```ts
const opMessage = msg?.state?.marquee?.display?.operatorComment?.content;
const userMessage = msg?.message?.chat;

const comment: NicoPongComment = {
  id: `${lvId}:${userMessage?.no ?? crypto.randomUUID()}`,
  lvId,
  no: userMessage?.no ?? 0,
  userId: userMessage?.hashedUserId || msg?.meta?.id || "0",
  userName: userMessage?.name || "",
  text: opMessage || userMessage?.content || "",
  textNotag: opMessage || userMessage?.content || "",
  premium: opMessage ? 2 : 0,
  postedAt: new Date(Number(msg?.meta?.at?.seconds ?? Date.now() / 1000) * 1000).toISOString(),
  isBroadcasterComment: !!opMessage,
  isOperatorComment: !!opMessage,
  isListenerComment: !!userMessage && !opMessage,
};
```

---

## 7. コメントから動画ID抽出

`src/shared/nicoVideoId.ts` を強化する。

### 7.1 対応形式

```text
sm9
nm12345
so12345
https://www.nicovideo.jp/watch/sm9
http://www.nicovideo.jp/watch/sm9
https://nico.ms/sm9
リク sm9
request sm9
```

### 7.2 抽出関数

```ts
export function extractNicoVideoIdsFromText(text: string): string[] {
  const normalized = text.trim();

  const patterns = [
    /\b((?:sm|nm|so)\d+)\b/gi,
    /(?:https?:\/\/)?(?:www\.)?nicovideo\.jp\/watch\/((?:sm|nm|so)\d+)/gi,
    /(?:https?:\/\/)?nico\.ms\/((?:sm|nm|so)\d+)/gi,
  ];

  const ids = new Set<string>();

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      if (match[1]) ids.add(match[1].toLowerCase());
    }
  }

  return [...ids];
}
```

注意：

- v0.2.1では `10桁数字ID` は対象外でもよい
- `sm9` のような短いIDにも対応する
- 同一コメントに複数IDがある場合はすべて追加する
- ただし一人のコメントで最大5件までなどの上限を設けてもよい

---

## 8. リクエストタブへの追加処理

`useVideoLists.ts` または repository に以下を実装する。

```ts
export async function appendVideoToRequestFromComment(params: {
  videoId: string;
  comment: NicoPongComment;
  requestUserName: string;
}): Promise<RequestAddResult> {
  // 1. リクエスト受付ON/OFF確認
  // 2. broadcaster/operator commentなら無視
  // 3. 重複確認
  // 4. 動画情報取得
  // 5. 作者名推定
  // 6. 引用可否チェック
  // 7. order = max(request.order) + 1
  // 8. requestSource = "comment"
  // 9. requestCommentNo, requestUserId, requestUserName を保存
  // 10. リクエストタブ最下部へ追加
}
```

### 8.1 order計算

必ず末尾追加。

```ts
const nextOrder = await videoRepository.getNextOrder("request");
```

または

```ts
const requestVideos = await listVideos("request");
const nextOrder =
  requestVideos.length === 0
    ? 0
    : Math.max(...requestVideos.map((v) => v.order)) + 1;
```

### 8.2 自動再生との連携

リクエストタブに動画が追加されたら、以下を行う。

```text
もし自動再生ON
かつ 現在再生中がない
かつ 自動再生ループが停止している
なら startAutoPlayLoop() を呼ぶ
```

---

## 9. @コテハン/名札検出

`src/shared/kotehan.ts` を追加する。

```ts
const IGNORE_KOTEHAN_NAMES = new Set([
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

export function extractKotehanFromComment(text: string): string | null {
  const match = text.match(/[@＠]([^0-9０-９\s@＠][^\s@＠]*?)$/);
  if (!match) return null;

  const name = match[1].trim();
  if (!name) return null;
  if (IGNORE_KOTEHAN_NAMES.has(name)) return null;

  return name;
}
```

### 9.1 表示名決定

```ts
export function resolveRequestUserName(params: {
  comment: NicoPongComment;
  existingKotehan?: KotehanProfile | null;
  extractedKotehan?: string | null;
}): string {
  // 1. comment.userName があれば優先（名札）
  // 2. extractedKotehan があれば使う
  // 3. existingKotehan があれば使う
  // 4. comment.userId
}
```

### 9.2 保存

`kotehanRepository.ts` を作る。

```ts
export async function getKotehan(userId: string): Promise<KotehanProfile | null>;

export async function upsertKotehan(profile: KotehanProfile): Promise<void>;

export async function resolveDisplayNameFromComment(
  comment: NicoPongComment
): Promise<string>;
```

注意：

- 名札があれば `source: "nametag"` で保存してよい
- `@コテハン` は `source: "at_comment"`
- 手動変更を後から入れるため、`source: "manual"` がある場合は自動更新で上書きしない

---

## 10. 作者名推定FIX

### 10.1 問題の想定原因

現在、生主コメントでタイトルとURLだけ出て作者名が出ない原因は、以下のいずれか。

- `displayAuthorName` が動画保存時に生成されていない
- `ownerName` / `user_nickname` のマッピングが壊れている
- タグ配列が `tags` ではなく `tags.jp` のような構造で保存されている
- 生主コメントテンプレートの変数名が実データと合っていない
- 再生時に使っている動画オブジェクトが古く、作者名フィールドを持っていない
- `replaceTemplate()` が `{displayAuthorName}` を展開していない

### 10.2 必ず保存時に `displayAuthorName` を作る

動画情報取得後、保存前に必ず実行する。

```ts
const inferred = inferDisplayAuthorName({
  ownerName: video.ownerName,
  tags: video.tags,
  lockedTags: video.lockedTags,
  manualAuthorName: video.manualAuthorName,
});

video.displayAuthorName = inferred.name || video.ownerName || "不明";
video.authorNameSource = inferred.source;
```

### 10.3 getthumbinfoのマッピング確認

XML取得時は以下を正しくマップする。

| getthumbinfo XML | nico pong |
|---|---|
| `user_nickname` | `ownerName` |
| `user_id` | `ownerId` |
| `ch_name` | `ownerName` |
| `ch_id` | `ownerId` |
| `tags tag` | `tags` |
| `tag lock="1"` | `lockedTags` |

### 10.4 タグ構造を正規化する

内部では必ず以下に揃える。

```ts
tags: string[];
lockedTags: string[];
```

`tags.jp` や `tags_array` のような構造がある場合も、保存前に配列へ正規化する。

```ts
export function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const all: string[] = [];
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") all.push(item);
        }
      }
    }
    return all;
  }

  return [];
}
```

---

## 11. 作者名推定関数

`src/shared/authorName.ts` を以下方針で修正する。

```ts
export type InferDisplayAuthorNameInput = {
  ownerName?: string;
  tags?: string[];
  lockedTags?: string[];
  manualAuthorName?: string;
};

export function inferDisplayAuthorName(
  input: InferDisplayAuthorNameInput
): { name: string; source: AuthorNameSource } {
  const manual = input.manualAuthorName?.trim();
  if (manual) return { name: manual, source: "manual" };

  const lockedTags = normalizeTagList(input.lockedTags);
  const tags = normalizeTagList(input.tags);

  const lockedP = findAuthorLikeTag(lockedTags, "tag_p");
  if (lockedP) return lockedP;

  const lockedWork = findAuthorLikeTag(lockedTags, "tag_work");
  if (lockedWork) return lockedWork;

  const lockedPerson = findAuthorLikeTag(lockedTags, "tag_person");
  if (lockedPerson) return lockedPerson;

  const normalP = findAuthorLikeTag(tags, "tag_p");
  if (normalP) return normalP;

  const normalWork = findAuthorLikeTag(tags, "tag_work");
  if (normalWork) return normalWork;

  const normalPerson = findAuthorLikeTag(tags, "tag_person");
  if (normalPerson) return normalPerson;

  if (input.ownerName?.trim()) {
    return { name: input.ownerName.trim(), source: "owner" };
  }

  return { name: "不明", source: "unknown" };
}
```

### 11.1 作者っぽいタグ判定

```ts
function findAuthorLikeTag(
  tags: string[],
  kind: "tag_p" | "tag_work" | "tag_person"
): { name: string; source: AuthorNameSource } | null {
  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized) continue;

    if (kind === "tag_p" && /^.{1,32}P$/i.test(normalized)) {
      if (isFalsePositivePTag(normalized)) continue;
      return { name: normalized, source: "tag_p" };
    }

    if (kind === "tag_work" && /^.{1,32}作品$/.test(normalized)) {
      if (isFalsePositiveWorkTag(normalized)) continue;
      return { name: normalized, source: "tag_work" };
    }

    if (kind === "tag_person" && /^.{1,32}の人$/.test(normalized)) {
      return { name: normalized, source: "tag_person" };
    }
  }

  return null;
}
```

### 11.2 誤判定除外

`○○P` には誤判定があり得るため、最低限以下を除外する。

```ts
const FALSE_POSITIVE_P_TAGS = new Set([
  "MMD",
  "MAD",
  "HD",
  "3DP",
  "2DP",
  "VOCALOID-PV",
]);

function isFalsePositivePTag(tag: string): boolean {
  const upper = tag.toUpperCase();
  return FALSE_POSITIVE_P_TAGS.has(upper);
}
```

必要に応じて後で増やす。

---

## 12. 生主コメントテンプレートFIX

### 12.1 テンプレート変数

`src/shared/broadcasterCommentTemplate.ts` を修正し、以下を展開できるようにする。

```text
{videoId}
{id}
{url}
{title}
{ownerName}
{displayAuthorName}
{author}
{viewCount}
{commentCount}
{mylistCount}
{likeCount}
{duration}
{requestUserName}
```

### 12.2 作者名変数の意味

```ts
const author =
  video.displayAuthorName ||
  inferDisplayAuthorName({
    ownerName: video.ownerName,
    tags: video.tags,
    lockedTags: video.lockedTags,
    manualAuthorName: video.manualAuthorName,
  }).name ||
  video.ownerName ||
  "不明";
```

以下は同じ値でよい。

```text
{displayAuthorName}
{author}
```

`{ownerName}` は投稿者アカウント名/チャンネル名だけを出す。

### 12.3 デフォルトテンプレート

v0.2.1のデフォルト主コメテンプレートは以下。

```text
♪ 再生中: {title}
作者: {author}
{url}
```

長すぎる場合は2〜3回に分けて投稿してよい。

例：

```text
♪ 再生中: {title}
作者: {author}
```

```text
{url}
```

### 12.4 主コメ80文字制限対策

ニコヘル側にも「現状主コメは80文字まで」というコメントがある。  
nico pongでも以下のどちらかを実装する。

簡易版：

- 80文字を超えてもまず送る
- APIエラーが返ったらエラー表示

推奨版：

- テンプレートを複数行/複数メッセージに分ける
- 各メッセージが80文字を超える場合は警告表示
- URLは別コメントに分ける

---

## 13. 生主コメント送信APIの確認

既に動いている場合でも、作者名修正に合わせて以下を確認する。

```http
PUT https://live2.nicovideo.jp/unama/api/v3/programs/{lvId}/broadcaster_comment
X-Public-Api-Token: {csrfToken}
FormData:
  text: string
  command: string
  name: string
  isPermanent: boolean
```

実装注意：

- `csrfToken` は `#embedded-data` から取得
- `csrfToken` は保存しない
- `csrfToken` はログに出さない
- API呼び出しはService WorkerでもSide Panelでもよいが、CORSで失敗する場合はService Workerへ寄せる
- `credentials: "include"` を付ける
- 失敗時は `meta.errorMessage` を表示する
- 「リクエスト間隔が短い」系エラーは指数バックオフで再試行する

---

## 14. 自動再生の安定化：リクエストタブを上から順に再生

今回、ユーザー報告として「リクエストタブに入っている動画が自動再生されない」問題がある。  
v0.2.1ではここも修正対象に含める。

### 14.1 基本仕様

```text
自動再生ON
↓
現在再生中がない
↓
リクエストタブの一番上から未再生・引用可の動画を探す
↓
quotation APIで再生
↓
再生成功したら playing
↓
durationSec + delay 経過後 played
↓
次の未再生・引用可動画を再生
```

### 14.2 自動再生対象

以下を満たす動画だけ自動再生。

```ts
function isAutoPlayable(video: NicoPongVideo): boolean {
  if (video.addedTo !== "request") return false;
  if (video.status === "played") return false;
  if (video.status === "skipped") return false;
  if (video.status === "error") return false;
  if (video.noLivePlay === true) return false;
  if (video.quotable === false) return false;
  return true;
}
```

### 14.3 次動画取得

```ts
export function findNextAutoPlayableRequest(videos: NicoPongVideo[]): NicoPongVideo | null {
  return [...videos]
    .filter(isAutoPlayable)
    .sort((a, b) => a.order - b.order)[0] ?? null;
}
```

### 14.4 自動再生ループ

`usePlaybackController.ts` に `ensureAutoPlayLoop()` を実装する。

```ts
async function ensureAutoPlayLoop(reason: string): Promise<void> {
  if (playbackMode !== "auto") return;
  if (playbackState.status === "playing" || playbackState.status === "loading") return;
  if (autoPlayLock.current) return;

  autoPlayLock.current = true;

  try {
    const videos = await videoRepository.listVideos("request");
    const next = findNextAutoPlayableRequest(videos);

    if (!next) {
      setAutoPlayStatus("idle_no_playable_video");
      return;
    }

    await playVideo(next, "request", { triggeredBy: reason, auto: true });
  } finally {
    autoPlayLock.current = false;
  }
}
```

### 14.5 呼び出しタイミング

以下のタイミングで `ensureAutoPlayLoop()` を呼ぶ。

```text
- 自動再生ONに切り替えたとき
- リクエストタブに動画が追加されたとき
- 再生中動画がplayedになったとき
- 引用不可エラーで動画がerrorになったとき
- Side Panel起動時に自動再生ONなら
```

### 14.6 再生終了判定

v0.2.1では、まずタイマーでよい。

```ts
const waitMs = ((video.durationSec ?? 0) + autoPlayDelaySec) * 1000;
```

`durationSec` がない場合：

- 自動で次へ進まない
- UIに「再生時間不明のため自動次動画不可」と表示
- 手動で「再生済みにする」「次へ」を押せるようにする

---

## 15. NG動画/引用不可自動マーキング

v0.2.1では、コメントリクエスト時にも引用不可を判断する。

### 15.1 getthumbinfoの `no_live_play`

動画情報取得時に `no_live_play` を `noLivePlay` に反映する。

```ts
video.noLivePlay = noLivePlay === 1 || noLivePlay === true;
```

### 15.2 quote services availability API

ニコヘルには以下の可否確認がある。

```http
GET https://services-eapi.spi.nicovideo.jp/v1/tools/live/quote/services/video/contents/{videoId}
```

レスポンスの `data.quotable` を使う。

```ts
export async function checkVideoQuotable(videoId: string): Promise<boolean | null> {
  // Service Workerからfetch
  // credentials: "include"
  // 200なら data.quotable
  // 失敗時は null
}
```

保存時：

```ts
video.quotable = quotableResult ?? undefined;
if (video.noLivePlay || video.quotable === false) {
  video.status = "error";
}
```

ただしリクエストタブには追加してよい。  
UI上に `引用不可` と表示し、自動再生対象から外す。

---

## 16. 重複・受付OFF・エラー時の生主コメント返信

v0.2.1では必須ではないが、余裕があれば実装する。

例：

```text
リクエスト受付: sm9 - 新・豪血寺一族 -煩悩解放 - レッツゴー！陰陽師
重複リクエストです: sm9
引用不可の可能性があります: sm9
リクエスト受付を停止しています
```

ただし主コメ投稿の連投になりすぎないよう、初期設定ではOFFでもよい。

---

## 17. 設定項目

`settingsRepository.ts` に以下を追加/確認。

```ts
export type NicoPongSettings = {
  playbackMode: "manual" | "auto";
  requestEnabled: boolean;
  autoKotehanEnabled: boolean;
  autoPlayDelaySec: number;
  postVideoInfoOnPlay: boolean;
  broadcasterCommentTemplates: string[];
};
```

デフォルト：

```ts
const DEFAULT_SETTINGS: NicoPongSettings = {
  playbackMode: "manual",
  requestEnabled: true,
  autoKotehanEnabled: true,
  autoPlayDelaySec: 2,
  postVideoInfoOnPlay: true,
  broadcasterCommentTemplates: [
    "♪ 再生中: {title}\n作者: {author}",
    "{url}",
  ],
};
```

---

## 18. UI追加/修正

### 18.1 リクエストタブ上部

```text
リクエスト受付: ON / OFF
自動再生: 手動 / 自動
コメント接続: 接続中 / 接続済み / エラー
```

### 18.2 動画カード

リクエスト由来なら以下を表示。

```text
リク主: {requestUserName}
コメントNo: {requestCommentNo}
```

作者表示：

```text
作者: {displayAuthorName}
作者判定: tag_p / tag_work / tag_person / owner / manual
```

### 18.3 コメント接続エラー

```text
コメントサーバーに接続できません。
番組ページを開いているか、生主としてログインしているか確認してください。
```

### 18.4 リクエスト追加通知

```text
リクエスト追加: sm9
```

---

## 19. デバッグログ

開発中は以下を出す。

```text
[comment] connected watch websocket
[comment] received messageServer
[comment] received user comment no=123 user=a:xxxx text=sm9
[request] extracted videoIds=["sm9"]
[request] appended sm9 order=5 requestUser=hogehoge
[author] sm9 displayAuthorName=xxxP source=tag_p
[broadcaster-comment] expanded text=...
```

出してはいけないもの：

- Cookie
- csrfToken
- APIキー
- 個人情報に該当し得る生レスポンス全文の永続保存

---

## 20. 動作確認手順

### 20.1 コメントリクエスト

1. 自分のニコ生番組ページを開く
2. nico pong Side Panelを開く
3. リクエスト受付ONを確認
4. 別アカウントまたは視聴者側から `sm9` とコメントする
5. nico pong のリクエストタブ最下部に `sm9` の動画ブロックが追加されること
6. リク主名が表示されること
7. 同じ `sm9` を再投稿しても重複追加されないこと

### 20.2 @コテハン

1. 視聴者側から `sm9 @テスト太郎` とコメント
2. リクエストブロックに `リク主: テスト太郎` と表示されること
3. 次回同じユーザーが `sm10` とだけコメントしても `テスト太郎` と表示されること

### 20.3 作者名付き生主コメント

1. 作者名タグを持つ動画を再生する
2. 生主コメントに以下が出ること

```text
♪ 再生中: タイトル
作者: hogehogeP
```

3. 作者名タグがない動画では投稿者名が出ること
4. 作者名が取得できない場合は `不明` と出ること

### 20.4 自動再生

1. リクエストタブに3件追加
2. 自動再生ON
3. 上から順に再生されること
4. 1本目終了後に2本目へ進むこと
5. 引用不可動画はスキップされること
6. 新しいコメントリクエストが追加された場合、末尾に追加され、順番通り再生されること

---

## 21. 受け入れ基準

v0.2.1は以下を満たしたら完成。

- 視聴者コメント `sm9` からリクエストタブへ追加される
- URL形式の動画リクエストも追加される
- 追加位置はリクエストタブ最下部
- 重複リクエストは追加されない
- `@コテハン` が保存・表示される
- 名札がある場合は名札をリク主名として使う
- 自分/生主/運営コメントはリクエスト扱いしない
- 生主コメントに作者名が表示される
- 作者名タグが投稿者名より優先される
- 投稿者名しかない動画では投稿者名が表示される
- `displayAuthorName` が保存される
- `{author}` / `{displayAuthorName}` がテンプレート展開される
- 自動再生ONでリクエストタブの上から順に連続再生される
- API直打ち方式を維持している
- DOMクリックでニコ生UIを操作していない
- `cookies` permissionを追加していない
- ID/パスワードを扱っていない
- `npm run build` が通る

---

## 22. AIへの追加プロンプト例

以下をAIコーディングエージェントに渡す。

```text
nico pong v0.2.1として、以下の実装漏れをFIXしてください。

不具合:
1. 視聴者がコメントで sm9 などを投稿しても、リクエストタブ最下部に動画情報が追加されない
2. 再生開始時の生主コメントで、タイトルとURLは表示されるが作者名が表示されない
3. リクエストタブの動画が自動再生ONでも上から順に自動再生されない場合がある

docs/nico-pong-v0.2.1-fix-comment-request-and-author.md の仕様に従ってください。

最優先:
- コメント受信をDOM監視ではなくWebSocket/message serverベースで実装
- 視聴者コメントから sm/nm/so またはURLを抽出
- リクエストタブの一番下へ動画情報付きで追加
- @コテハン/名札をリク主名に反映
- 動画保存時に displayAuthorName を必ず生成
- 生主コメントテンプレートで {author} / {displayAuthorName} を展開
- 自動再生ON時はリクエストタブを上から順に連続再生

制約:
- ニコ生UIをDOMクリックしない
- API/WS直打ちを前提にする
- Cookie値を読まない
- cookies permissionを追加しない
- csrfTokenを保存しない
- npm run buildを通す

実装後、以下を報告してください。
- 変更ファイル
- コメント接続方式
- sm9コメントからリクエスト追加できたか
- 作者名付き生主コメントの確認結果
- 自動再生の確認結果
- 未解決TODO
```

---

## 23. 注意点

### 23.1 コメント受信は難所

NDGR/protobufデコードは実装難度が高い。  
一度で完成しない場合は、まず `messageServer` 取得まで実装し、その後コメントデコードを実装する。

ただし最終的なv0.2.1受け入れ基準では、視聴者コメント `sm9` からリクエストタブ追加まで必須とする。

### 23.2 作者名FIXは先に終わらせる

コメント受信より簡単なので、以下は先に直す。

```text
動画情報取得
↓
tags / lockedTags 正規化
↓
displayAuthorName生成
↓
生主コメントテンプレート展開
```

これだけで2番の不具合は直る可能性が高い。

### 23.3 自動再生は必ずlockを入れる

連続再生で多重起動すると、同じ動画が二重再生されたり、順番が飛ぶ。  
`autoPlayLock` を必ず使う。

---

## 24. まとめ

v0.2.1の核心は以下。

```text
コメント sm9
↓
API/WSでコメント受信
↓
動画情報取得
↓
作者名推定
↓
リクエストタブ最下部へ追加
↓
自動再生ONなら上から順に再生
↓
再生開始時に作者名付き主コメ投稿
```

この修正で、nico pong はようやく「動画紹介放送支援ツール」として最低限のPitaCoreらしい動作に到達する。
