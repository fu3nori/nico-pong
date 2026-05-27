# nico-pong 追加修正指示：コメントから動画IDを取得してリクエストタブへ登録する

## 目的

現在の nico-pong では、リクエストタブに入っている動画の自動再生は動作している。

しかし、生放送の来場者がコメントで動画IDを投稿しても、リクエストタブに動画情報が登録されない。

この修正では、**誰のリクエストかの厳密な判別はいったん捨てる**。  
まずは以下を最優先で実装する。

```text
ニコ生コメントを取得する
↓
コメント本文から動画IDを抽出する
↓
動画情報を取得する
↓
リクエストタブへ登録する
```

---

## 参考にする実装

以下の nicolivehelperxx の実装を参考にする。

```text
https://github.com/amanorox/nicolivehelperxx
```

特に見るべきファイルは以下。

```text
main/comm.js
main/main.js
main/comment.js
main/request.js
libs/protobuf.js
libs/schema.js
```

### 参考ポイント

nicolivehelperxx では、コメント取得まわりは概ね以下の流れになっている。

```text
1. 番組視聴 WebSocket に接続する
2. startWatching を送る
3. messageServer 情報を受け取る
4. messageServer の viewUri からコメントストリームを fetch する
5. protobuf で ChunkedEntry / ChunkedMessage を decode する
6. message.chat.content からリスナーコメント本文を取り出す
7. コメント本文に sm/nm/so/10桁ID が含まれていればリクエスト登録する
```

旧式のコメント WebSocket JSON だけに依存しないこと。  
現在のニコ生コメント取得は、`messageServer` から得た `viewUri` に対して fetch streaming し、protobuf を decode する方式を優先する。

---

## 今回の実装方針

### 最優先仕様

- 生放送ページで来場者コメントを監視する
- コメント本文から動画IDを抽出する
- 抽出した動画IDを既存のリクエスト追加処理へ渡す
- リクエストタブに動画タイトル・作者名・URLなどが表示される
- 自動再生ONの場合、コメント由来のリクエストも既存の自動再生キューに乗る

### 今回やらないこと

以下は今回の必須範囲から外す。

- リクエスト者名の正確な表示
- コテハン管理との連携
- NGユーザー判定
- NGワード判定
- ニコ生アカウントIDとユーザー名の逆引き
- リクエスト受付可否の細かいUI
- コメント返信の高度な文面制御

ただし、将来拡張できるように `commentNo` / `hashedUserId` / `rawComment` などの情報は保持できる構造にしておく。

---

## 実装タスク

## 1. コメント監視サービスを追加する

nico-pong 側に、コメント取得専用のサービスを追加する。

候補ファイル名：

```text
src/services/nicoLiveCommentService.ts
src/lib/nicoLiveCommentService.ts
src/background/commentWatcher.ts
src/content/commentWatcher.ts
```

既存構成に合わせて配置すること。

### 注意

Manifest V3 の Service Worker は停止しやすいため、長時間のコメント監視はできれば以下のどちらかで行う。

```text
推奨1: SidePanel が開いている間、SidePanel 側で監視する
推奨2: 生放送ページに注入した content script 側で監視する
```

Service Worker だけで永続的に fetch stream / WebSocket を維持しようとしないこと。

---

## 2. 番組視聴 WebSocket に接続する

nicolivehelperxx の `connectServer` 相当の処理を実装する。

既存実装で `webSocketUrl` と `frontendId` を取得済みの場合は、それを使う。

概念コード：

```ts
type LivePropLike = {
  program?: {
    nicoliveProgramId?: string;
    title?: string;
  };
  site?: {
    frontendId?: string;
    relive?: {
      webSocketUrl?: string;
      csrfToken?: string;
    };
  };
};

function connectWatchWebSocket(liveProp: LivePropLike) {
  const baseUrl = liveProp.site?.relive?.webSocketUrl;
  const frontendId = liveProp.site?.frontendId;

  if (!baseUrl) {
    throw new Error("webSocketUrl が取得できません");
  }

  const wsUrl = frontendId
    ? `${baseUrl}&frontend_id=${encodeURIComponent(frontendId)}`
    : baseUrl;

  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      type: "startWatching",
      data: {}
    }));
  });

  ws.addEventListener("message", async (event) => {
    const data = JSON.parse(event.data);
    await handleWatchCommand(data);
  });

  ws.addEventListener("error", (event) => {
    console.warn("[nico-pong] watch websocket error", event);
  });

  return ws;
}
```

---

## 3. messageServer を受け取る

番組視聴 WebSocket の受信データから `type: "messageServer"` を検出する。

概念コード：

```ts
async function handleWatchCommand(data: any) {
  switch (data?.type) {
    case "messageServer": {
      const room = normalizeMessageServerRoom(data.data);
      await connectCommentMessageServer(room);
      break;
    }

    case "ping": {
      // 必要なら watch WebSocket に pong を返す
      break;
    }

    default:
      break;
  }
}
```

`data.data` の構造が変わる可能性に備えて、正規化関数を作る。

```ts
type CommentRoom = {
  viewUri: string;
  threadId?: string;
  name?: string;
};

function normalizeMessageServerRoom(data: any): CommentRoom {
  const room = data?.room ?? data;

  const viewUri =
    room?.viewUri ??
    room?.messageServer?.viewUri ??
    room?.messageServer?.uri ??
    data?.viewUri ??
    data?.messageServer?.viewUri ??
    data?.messageServer?.uri;

  if (!viewUri) {
    throw new Error("messageServer.viewUri が取得できません");
  }

  return {
    viewUri,
    threadId: room?.threadId ?? data?.threadId,
    name: room?.name ?? data?.name
  };
}
```

---

## 4. コメントメッセージサーバーへ接続する

nicolivehelperxx の `connectCommentServer(room)` 相当を実装する。

ポイントは以下。

- `room.viewUri` に対して fetch する
- `?at=${timestamp}` を付けて取得開始する
- `ChunkedEntry` を decode する
- `entry.segment.uri` が来たら、その segment を `ChunkedMessage` として読む
- `entry.next.at` が来たら次の取得時刻としてループする

概念コード：

```ts
async function connectCommentMessageServer(room: CommentRoom) {
  const ChunkedEntry =
    protobuf.roots.default.dwango.nicolive.chat.service.edge.ChunkedEntry;

  let next: number | null = Math.floor(Date.now() / 1000) - 30;
  let initialized = false;

  while (next) {
    const currentNext = next;
    next = null;

    const uri = `${room.viewUri}?at=${currentNext}`;

    for await (const entry of messageRetriever(uri, ChunkedEntry)) {
      if (entry?.segment?.uri) {
        initialized = true;
        pullMessages(entry.segment.uri).catch((err) => {
          console.warn("[nico-pong] pullMessages failed", err);
        });
      }

      if (entry?.next?.at) {
        next = Number(entry.next.at);
      }
    }

    if (!initialized) {
      await sleep(1000);
    }
  }
}
```

### 注意

`pullMessages(entry.segment.uri)` は await しすぎないこと。  
nicolivehelperxx と同じく、segment を読む処理で次の entry 取得が詰まらないようにする。

---

## 5. protobuf decoder を用意する

nicolivehelperxx は以下を利用している。

```text
libs/protobuf.js
libs/schema.js
```

nico-pong でも以下のどちらかで protobuf decode を可能にする。

### 案A：nicolivehelperxx の libs/protobuf.js / libs/schema.js を取り込む

MIT ライセンス表記を残した上で、必要なファイルを nico-pong に取り込む。

候補配置：

```text
src/vendor/nicolivehelperxx/protobuf.js
src/vendor/nicolivehelperxx/schema.js
```

### 案B：npm の protobufjs を使う

既にビルド環境がある場合はこちらでもよい。

```bash
npm install protobufjs
```

ただし、nicolivehelperxx の `schema.js` 相当の schema を読み込めるようにすること。

---

## 6. messageRetriever を実装する

fetch stream から protobuf の delimited message を順次 decode する。

概念コード：

```ts
async function* messageRetriever(uri: string, decoder: any) {
  const res = await fetch(uri, {
    credentials: "include",
    cache: "no-store"
  });

  if (!res.ok || !res.body) {
    throw new Error(`comment fetch failed: ${res.status} ${uri}`);
  }

  const reader = res.body.getReader();
  let unread: number[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const bytes = Array.from(value);
    const buffer = new protobuf.Reader([...unread, ...bytes]);
    unread = [];

    while (buffer.pos < buffer.len) {
      const currentPos = buffer.pos;

      try {
        yield decoder.decodeDelimited(buffer);
      } catch (err) {
        if (err instanceof RangeError) {
          unread = Array.from(buffer.buf.slice(currentPos, buffer.len));
          break;
        }

        throw err;
      }
    }
  }
}
```

### 重要

Chrome 拡張から fetch する場合、`manifest.json` の `host_permissions` にコメント取得先が含まれている必要がある。

暫定的には以下を確認する。

```json
{
  "host_permissions": [
    "https://*.nicovideo.jp/*",
    "https://*.nimg.jp/*",
    "https://*.dwango.jp/*"
  ]
}
```

もし `room.viewUri` が別ドメインを返す場合は、そのドメインも追加すること。

---

## 7. ChunkedMessage からコメント本文を取り出す

nicolivehelperxx の `pull_messages` 相当を実装する。

概念コード：

```ts
async function pullMessages(uri: string) {
  const ChunkedMessage =
    protobuf.roots.default.dwango.nicolive.chat.service.edge.ChunkedMessage;

  for await (const msg of messageRetriever(uri, ChunkedMessage)) {
    const opMessage =
      msg?.state?.marquee?.display?.operatorComment?.content;

    const userMessage = msg?.message?.chat;

    if (!opMessage && !userMessage) {
      continue;
    }

    const chat = {
      premium: opMessage ? 2 : 0,
      date: Number(msg?.meta?.at?.seconds ?? 0),
      text: opMessage || userMessage?.content || "",
      text_notag: opMessage || userMessage?.content || "",
      name: userMessage?.name || "",
      user_id: userMessage?.hashedUserId || msg?.meta?.id || "0",
      no: Number(userMessage?.no ?? 0),
      comment_no: Number(userMessage?.no ?? 0),
      raw: msg
    };

    processIncomingComment(chat);
  }
}
```

---

## 8. リスナーコメントだけをリクエスト判定に回す

運営コメント・生主コメント・システムコメントは動画ID抽出対象から外す。

今回の簡易判定では、以下でよい。

```ts
function processIncomingComment(chat: any) {
  const text = String(chat.text_notag ?? chat.text ?? "");

  if (!text) return;

  // premium 2 / 3 / 7 相当は主コメ・運営コメント扱いなので今回は無視
  if (chat.premium === 2 || chat.premium === 3 || chat.premium === 7) {
    return;
  }

  handleRequestIdsFromComment(text, chat);
}
```

---

## 9. コメント本文から動画IDを抽出する

nicolivehelperxx の `processListenersComment` では、リスナーコメント本文から `(sm|nm)\d+` を拾ってリクエスト登録している。

nico-pong では `so` と 10桁IDも拾えるようにする。

```ts
const VIDEO_ID_PATTERN = /(?:https?:\/\/www\.nicovideo\.jp\/watch\/)?((?:sm|nm|so)\d+|\d{10})/gi;

function extractVideoIdsFromComment(text: string): string[] {
  const ids = new Set<string>();

  for (const match of text.matchAll(VIDEO_ID_PATTERN)) {
    const id = match[1];

    if (!id) continue;
    if (id === "8888888888") continue;

    ids.add(id);
  }

  return [...ids];
}
```

### 対応するコメント例

以下のすべてから動画IDを抽出できること。

```text
sm9
sm12345678
nm12345678
so12345678
1234567890
https://www.nicovideo.jp/watch/sm12345678
これお願いします sm12345678
sm12345678 nm87654321
```

---

## 10. 既存のリクエスト追加処理へ接続する

既存の nico-pong に、すでに手動追加・マイリスト追加・ストック追加などの処理がある場合、そこへ流用する。

望ましい設計：

```ts
async function handleRequestIdsFromComment(text: string, chat: any) {
  const videoIds = extractVideoIdsFromComment(text);

  for (const videoId of videoIds) {
    await addRequestFromComment(videoId, chat);
  }
}
```

```ts
async function addRequestFromComment(videoId: string, chat: any) {
  if (isAlreadyRequested(videoId)) {
    console.info("[nico-pong] duplicate request skipped", videoId);
    return;
  }

  const requestMeta = {
    source: "comment",
    commentNo: chat.comment_no ?? 0,
    requesterUserId: "0",
    requesterName: "",
    rawRequesterId: chat.user_id ?? "0",
    rawComment: chat.text ?? "",
    requestedAt: Date.now()
  };

  await requestStore.addByVideoId(videoId, requestMeta);
}
```

### 重要

今は誰のリクエストかを厳密に出さないため、以下でよい。

```ts
requesterUserId: "0"
requesterName: ""
```

ただし、将来使えるように以下は保存してよい。

```ts
rawRequesterId: chat.user_id
commentNo: chat.comment_no
rawComment: chat.text
```

---

## 11. 動画情報取得に失敗しても監視を止めない

コメントから動画IDを拾った後、動画情報取得に失敗することがある。

例：

- 削除済み動画
- 非公開動画
- 引用再生できない動画
- 一時的なAPI失敗
- ニコニコ側の制限

この場合でも、コメント監視全体を止めないこと。

```ts
try {
  await requestStore.addByVideoId(videoId, requestMeta);
} catch (err) {
  console.warn("[nico-pong] request add failed", videoId, err);
}
```

---

## 12. 重複登録を防ぐ

同じコメントを複数 segment から拾う可能性があるため、最低限の重複防止を入れる。

```ts
const seenCommentKeys = new Set<string>();
const pendingVideoIds = new Set<string>();

function makeCommentKey(chat: any): string {
  return `${chat.comment_no ?? 0}:${chat.user_id ?? "0"}:${chat.text ?? ""}`;
}
```

```ts
function processIncomingComment(chat: any) {
  const key = makeCommentKey(chat);

  if (seenCommentKeys.has(key)) {
    return;
  }

  seenCommentKeys.add(key);

  if (seenCommentKeys.size > 1000) {
    const first = seenCommentKeys.values().next().value;
    seenCommentKeys.delete(first);
  }

  const text = String(chat.text_notag ?? chat.text ?? "");

  if (chat.premium === 2 || chat.premium === 3 || chat.premium === 7) {
    return;
  }

  handleRequestIdsFromComment(text, chat);
}
```

動画ID単位の二重処理も防ぐ。

```ts
async function addRequestFromComment(videoId: string, chat: any) {
  if (pendingVideoIds.has(videoId)) return;
  if (isAlreadyRequested(videoId)) return;

  pendingVideoIds.add(videoId);

  try {
    await requestStore.addByVideoId(videoId, {
      source: "comment",
      commentNo: chat.comment_no ?? 0,
      requesterUserId: "0",
      requesterName: "",
      rawRequesterId: chat.user_id ?? "0",
      rawComment: chat.text ?? "",
      requestedAt: Date.now()
    });
  } finally {
    pendingVideoIds.delete(videoId);
  }
}
```

---

## 13. 接続状態を SidePanel に表示する

デバッグしやすいよう、SidePanel のどこかにコメント監視状態を表示する。

最低限でよい。

```text
コメント監視: 未接続
コメント監視: 接続中
コメント監視: 受信中
コメント監視: エラー
```

ログにも出す。

```ts
console.info("[nico-pong] comment watcher connected");
console.info("[nico-pong] comment received", chat.text);
console.info("[nico-pong] video id detected", videoId);
console.info("[nico-pong] request added from comment", videoId);
```

---

## 14. 自動再接続

コメント取得が切れた場合、数秒待って再接続する。

```ts
let reconnectTimer: number | undefined;

function scheduleReconnect(reason: unknown) {
  console.warn("[nico-pong] comment watcher reconnect scheduled", reason);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  reconnectTimer = window.setTimeout(() => {
    startCommentWatcher().catch((err) => {
      scheduleReconnect(err);
    });
  }, 3000);
}
```

ただし、同時に複数の監視ループが走らないようにする。

```ts
let isWatcherRunning = false;

async function startCommentWatcher() {
  if (isWatcherRunning) {
    console.info("[nico-pong] comment watcher already running");
    return;
  }

  isWatcherRunning = true;

  try {
    // connect watch websocket
  } finally {
    isWatcherRunning = false;
  }
}
```

---

## 15. manifest.json の権限確認

`manifest.json` に必要な host permissions があるか確認する。

最低限の候補：

```json
{
  "host_permissions": [
    "https://www.nicovideo.jp/*",
    "https://live.nicovideo.jp/*",
    "https://live2.nicovideo.jp/*",
    "https://*.nicovideo.jp/*",
    "https://*.nimg.jp/*",
    "https://*.dwango.jp/*"
  ]
}
```

実際に `room.viewUri` が返すドメインを DevTools で確認し、不足があれば追加すること。

---

## 16. バージョンを上げる

今回の修正はコメント取得・リクエスト受付の重要修正なので、バージョン番号を上げる。

`manifest.json` の `version` を現在値から 1 パッチ上げる。

例：

```text
0.1.1 → 0.1.2
0.1.2 → 0.1.3
0.2.0 → 0.2.1
```

`package.json` に `version` がある場合は、`manifest.json` と同じバージョンに揃える。

---

## 17. 動作確認

### 確認1：コメント監視状態

生放送ページを開き、nico-pong SidePanel を開いた状態で、コメント監視状態が以下のように変化すること。

```text
未接続 → 接続中 → 受信中
```

### 確認2：通常の動画IDコメント

来場者側、または別アカウント側から以下をコメントする。

```text
sm9
```

期待結果：

```text
sm9 の動画情報がリクエストタブに登録される
```

### 確認3：文章中の動画ID

以下をコメントする。

```text
これお願いします sm12345678
```

期待結果：

```text
sm12345678 がリクエストタブに登録される
```

### 確認4：URL形式

以下をコメントする。

```text
https://www.nicovideo.jp/watch/sm12345678
```

期待結果：

```text
sm12345678 が抽出され、リクエストタブに登録される
```

### 確認5：複数ID

以下をコメントする。

```text
sm12345678 nm87654321
```

期待結果：

```text
2件ともリクエストタブに登録される
```

### 確認6：重複防止

同じ動画IDを連続でコメントする。

期待結果：

```text
既にリクエストタブに存在する動画は重複登録されない
```

### 確認7：自動再生との連携

自動再生ONの状態で、コメント由来のリクエストを登録する。

期待結果：

```text
リクエストタブに登録された動画が既存の自動再生処理で再生される
```

---

## 完了条件

- 生放送コメントを現在の messageServer / protobuf 方式で取得できる
- リスナーコメント本文から動画IDを抽出できる
- `sm` / `nm` / `so` / 10桁ID / watch URL 形式に対応している
- 抽出した動画IDがリクエストタブに登録される
- 動画情報取得に失敗してもコメント監視が止まらない
- 重複コメント・重複動画IDで二重登録されない
- 自動再生ON時、コメント由来のリクエストも再生対象になる
- `manifest.json` のバージョンがパッチアップされている
- `package.json` がある場合、バージョンが `manifest.json` と一致している

---

## 実装時のメモ

今回のゴールは「高機能なリクエスト管理」ではなく、**コメントからリクエストを拾う経路の復旧**である。

そのため、実装優先度は以下。

```text
最優先: コメント受信できる
最優先: 動画IDを拾える
最優先: リクエストタブに入る
後回し: 誰のリクエストかを綺麗に表示する
後回し: NGユーザー / NGワード
後回し: 高度な返信文面
```

まずは `console.log` で以下が確認できれば勝ち。

```text
[nico-pong] comment received sm12345678
[nico-pong] video id detected sm12345678
[nico-pong] request added from comment sm12345678
```
