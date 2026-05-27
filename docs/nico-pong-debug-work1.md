# nico-pong debug work1: コメント動画IDがリクエストに入らない問題の修正指示

作成日: 2026-05-27  
対象: nico-pong / NicoPitaCore  
目的: ニコ生の視聴者コメントに含まれる動画IDがリクエストタブへ登録されない問題を、現在の実装状況と過去のエラーを踏まえて修正する。

このファイルは以降のエージェント作業の引き継ぎ先とする。作業経過、判断、検証結果、未解決事項はこのファイルへ追記すること。

## 1. 現状認識

`docs/nico-pong-debug-log.md` によると、v0.3.6 時点で以下は改善済みまたは到達済み。

- watch WebSocket 接続は成功している。
- `startWatching` は送信されている。
- `seat` は受信されている。
- `keepSeat` は送信されている。
- `messageServer` は受信されている。
- `messageServer.data.viewUri` は取得できている。
- `https://mpn.live.nicovideo.jp/api/view/v4/...` への NDGR stream fetch は動作している。
- protobuf decode は成功している。
- 少なくとも1件の `NicoLiveComment` は side panel 側まで届いている。

したがって、今回の主な疑いは「`#embedded-data` から `site.relive.webSocketUrl` が取れない」だけではない。過去の critical issue ではこの経路が疑われていたが、現在のログでは watch WS 以降まで到達している。

現在の主な問題は次のどれか、または複合である。

1. 実際に動画ID入りコメントを受信できていない。
2. NDGR の backlog / previous / backward segment を読んでおらず、テスト投稿タイミングによって取り逃している。
3. `Chat.content` の decode field が現行仕様とずれており、本文ではない値を本文として扱っている。
4. 受信した動画ID入りコメントが operator comment / own post 扱いで `useCommentToRequest` によりスキップされている。
5. リクエスト受付設定が `accept` / `autoAcceptCommentRequests=true` でなく、抽出後にスキップされている。
6. `useCommentDebug` の stale error 表示により、実際の停止箇所を誤認している。

## 2. 関係ファイル

主要ファイル:

- `src/content/nicoliveContentScript.ts`
  - `#embedded-data` / `data-props` の読み取り。
  - `GET_NICOLIVE_CONTEXT` への応答。
  - `webSocketUrl` 候補探索。

- `src/sidepanel/hooks/useCommentProvider.ts`
  - side panel から content script へ `GET_NICOLIVE_CONTEXT` を送る。
  - `NicoLiveCommentProvider` を起動する。
  - `webSocketUrl` が空の場合はここで停止する。

- `src/sidepanel/services/nicoLiveCommentProvider.ts`
  - watch WebSocket 接続。
  - `startWatching` 送信。
  - `seat` / `keepSeat` / `ping` / `pong` 処理。
  - `messageServer` / `room` から `viewUri` を取得。
  - `ChunkedEntry` / `ChunkedMessage` stream fetch。
  - decode 結果を `NicoLiveComment` として emit。

- `src/sidepanel/services/ndgrCodec.ts`
  - CSP 回避のため `Type.decode()` を使わず `protobuf.Reader` を直接使う decoder。
  - `Chat.content` / `OperatorComment` / `segmentUri` / `nextAt` を読む。

- `src/shared/commentParsing.ts`
  - コメント本文から `sm/nm/so` を抽出する。

- `src/sidepanel/hooks/useCommentToRequest.ts`
  - コメント受信後、受付設定・operator/own post・NG・重複を判定。
  - 動画ID抽出。
  - `fetchNicoVideoInfo()`。
  - `addVideo("request", draft)`。

- `src/sidepanel/hooks/useCommentDebug.ts`
  - コメント取得からリクエスト追加までの可視化。
  - 現状 `lastError` が stale になりやすい。

- `src/sidepanel/components/CommentDebugPanel.tsx`
  - debug state の画面表示。

- `src/sidepanel/App.tsx`
  - `useCommentProvider` の `onComment` を `useCommentToRequest` へ接続。

## 3. 現在の処理フロー

1. side panel のコメント接続操作で `useCommentProvider.connect()` が呼ばれる。
2. `useCommentProvider` がニコ生タブを探し、content script へ `GET_NICOLIVE_CONTEXT` を送る。
3. content script が `#embedded-data` を parse し、`lvId`、`csrfToken`、`isBroadcaster`、`webSocketUrl`、候補URLを返す。
4. `webSocketUrl` が空なら `useCommentProvider` で error になり終了する。
5. URL があれば `NicoLiveCommentProvider.connect()` が watch WebSocket を開く。
6. open 後に `startWatching` を送る。
7. `ping` には `pong` と `keepSeat` を返す。
8. `seat` 受信後、`keepIntervalSec` に従って定期 `keepSeat` を送る。
9. `messageServer` または `room` 受信後、`viewUri` を取り、`startEntryLoop(viewUri)` を開始する。
10. `viewUri?at=now` を fetch し、`ChunkedEntry` を decode する。
11. `entry.segmentUri` があれば segment を fetch し、`ChunkedMessage` を decode する。
12. `msg.chat` があれば `NicoLiveComment` に変換し `events.onComment` を呼ぶ。
13. `App.tsx` の `handleCommentReceived()` が debug 記録後、`useCommentToRequest.handleComment()` を呼ぶ。
14. `useCommentToRequest` が受付設定、operator/own post、NG、重複を確認する。
15. `extractVideoIdsFromComment(comment.text)` で `sm/nm/so` を抽出する。
16. `fetchNicoVideoInfo(videoId)` と引用可否チェックを行う。
17. `addVideo("request", draft)` でリクエストタブへ追加する。

## 4. 過去に直した問題

### 4.1 ReadyForNext.at の wire type 不一致

過去の原因:

- `ReadyForNext.at` を `string` として扱っていた。
- 実際の NDGR は `int64` varint で返していた。
- このため `next.at` が読めず `?at=now` ループになっていた。

現在:

- `ndgrCodec.ts` 側で int64 / number / string を扱う方針に変更済み。
- `?at=` が `now` から実タイムスタンプに進むことはログ上確認済み。

### 4.2 protobufjs codegen と MV3 CSP

過去の原因:

- `protobufjs Type.decode()` が内部で `new Function()` を使う。
- Manifest V3 CSP で `unsafe-eval` が禁止されており decode 失敗。

現在:

- `ndgrCodec.ts` で `protobuf.Reader` を直接使う手動 decoder に変更済み。
- `decode_ok` が増えることはログ上確認済み。

## 5. 現在疑うべき箇所

### 5.1 stale error による誤認

ログ上、WebSocket や decode は正常なのに `lastError` に以下が残っている。

```text
Content Script communication failed: Could not establish connection. Receiving end does not exist.
```

これは初回 connect 時に content script がまだ注入されていない、またはタブ reload 中だった可能性が高い。その後の再接続で成功しても `useCommentDebug` の `lastError` が clear されないため、画面に古いエラーが残る。

修正方針:

- `useCommentDebug` に `clearError()` action を追加する。
- `useCommentProvider.connect()` 開始時、または成功イベント受信時に `lastError` を clear する。
- ただし `debugActions.reset()` を connect 開始ごとに呼ぶと過去イベントも消えるため、切り分け中は `lastError` のみ clear する方がよい。

期待結果:

- watch WS / decode / comment 受信が進んでいるときに、古い content script エラーが残らない。

### 5.2 backlog / previous / backward segment 未取得

現在 `ChunkedEntry` decode 結果のうち、`entry.segmentUri` のみ `streamChunkedMessages()` している。`backwardUri` / `previousUri` は decode しているが使用していない。

問題:

- 接続直後やテスト投稿タイミングによって、動画ID入りコメントが `backward` または `previous` 側に入る可能性がある。
- 現在はリアルタイム segment のみ読むため、テストコメントが接続直前または segment window 外だと拾えない。

修正方針:

- `streamChunkedEntry()` 内で `entry.backwardUri` と `entry.previousUri` も初回のみ読む。
- ただし無制限に読むと大量 backlog を処理するため、まずは接続直後の切り分け用に上限を設ける。
- 推奨:
  - `seenSegmentUris: Set<string>` を provider に追加。
  - `pullSegmentOnce(uri, reason)` のような helper を作る。
  - `segmentUri` / `backwardUri` / `previousUri` を同じ helper 経由で読む。
  - `backward` / `previous` は接続直後の最初の数件、または `maxBacklogSegments = 3` 程度に制限する。

debug 追加:

- stage は既存の `message_stream` でよいが、detail に `{ label: "segment", reason: "live" | "backward" | "previous", url }` を入れる。
- UI に reason を表示できると望ましい。

期待結果:

- 接続直前または接続直後に投稿した `sm9` などが取り逃されにくくなる。

### 5.3 `messageServer` / `viewUri` 正規化不足

現在は主に以下を見ている。

```ts
data?.viewUri || data?.messageServer?.viewUri
```

不足している可能性:

- `data.room.viewUri`
- `data.room.messageServer.viewUri`
- `data.messageServer.uri`
- `data.room.messageServer.uri`

修正方針:

- `normalizeMessageServerRoom(msg)` を作り、揺れを吸収する。
- 取得できなかった場合は `Object.keys(data)` と浅い shape を debug event に出す。

期待結果:

- 現行ログでは `viewUri` は取れているが、別番組やページ更新後でも安定する。

### 5.4 `frontend_id` 未付与

docs には `site.frontendId` を `frontend_id` として watch WebSocket URL に付ける案がある。現在の実装は `frontendId` を取得・付与していない。

現状では watch WS 接続は成功しているため最優先ではない。ただし番組やページ状態により必要になる可能性がある。

修正方針:

- `EmbeddedRoot.site.frontendId` を型に追加。
- `NicoliveContext` に `frontendId?: string | number` を追加。
- `buildWatchWebSocketUrl(baseUrl, frontendId)` を provider 側または hook 側に追加。
- base URL にすでに `frontend_id` がある場合は重複付与しない。

期待結果:

- watch WS 接続の安定性向上。

### 5.5 `Chat.content` decode が正しいか確認

ログでは受信コメント本文が `a:yFoT-eEGfI5YRHFh` となっている。これは `sm/nm/so` ではないため抽出失敗自体は正常。ただし、これが本当に視聴者コメント本文なのかは確認が必要。

疑い:

- NDGR `Chat` の field 番号が現行仕様と違い、本文以外を `content` として読んでいる可能性。
- システム的な短いコメントまたは bot コメントを拾っているだけの可能性。

調査方針:

- `decodeChat()` で unknown field の簡易 debug を追加する。ただし本文や個人情報を大量にログしない。
- 文字列 field を `fieldNo -> valuePreview` として debug event に出せるようにする。
- `content` と判定している field 6 以外に、実際の `sm9` が含まれる field がないか確認する。

注意:

- 本番画面に生コメント全文を大量表示しない。直近1件と短い preview で十分。
- 個人情報・Cookie・token はログに出さない。

### 5.6 operator / own post スキップ

`useCommentToRequest` は以下を即 return する。

```ts
if (comment.isOperatorComment === true) return;
if (comment.isOwnPost === true) return;
```

つまり、生主コメント欄から送った動画IDはリクエスト登録されない。視聴者コメントでテストする必要がある。

修正方針:

- まず debug UI に「スキップ理由」を表示する。
- `useCommentToRequest` の early return 前に debug event を出す。
- 例:
  - `request_skip: accept mode is stop`
  - `request_skip: autoAcceptCommentRequests=false`
  - `request_skip: operator comment`
  - `request_skip: own post`

型追加が重い場合:

- 既存 `request_add` stage の `ok=false` として `skip: ...` を message に出してもよい。

期待結果:

- コメントを受信したのに登録されない理由が UI で分かる。

### 5.7 acceptance settings の可視化不足

`useCommentToRequest` は以下の設定で停止する。

```ts
requestAcceptMode !== "accept"
autoAcceptCommentRequests === false
```

現在の debug panel にはこの設定が表示されない。動画ID抽出前に return するため、コメントは届いているのに「抽出されない」ように見える。

修正方針:

- `CommentDebugPanel` に現在の受付設定を表示する。
- `App.tsx` から `acceptance` を `CommentDebugPanel` に渡すか、debug state に snapshot を持たせる。
- 最小なら `useCommentToRequest` の early return 前に debug event としてスキップ理由を記録する。

期待結果:

- 「受付停止中」「コメントリクエスト自動受付 OFF」がすぐ分かる。

## 6. 最小修正案

優先順位順に実施する。

### Step 1: stale error とスキップ理由の可視化

目的:

- 実際に止まっている箇所を誤認しないようにする。
- コメント受信後に `useCommentToRequest` がなぜ進まないか分かるようにする。

変更候補:

- `src/sidepanel/hooks/useCommentDebug.ts`
  - `clearError()` を追加。
  - `onRequestSkipped(reason, detail?)` を追加、または `onAddRequestFailed` を流用。

- `src/sidepanel/hooks/useCommentProvider.ts`
  - connect 開始時または `watch_ws_connect` 成功時に `clearError()` を呼ぶ。

- `src/sidepanel/hooks/useCommentToRequest.ts`
  - early return する各箇所で debug を記録する。
  - `requestAcceptMode !== "accept"`
  - `!autoAcceptCommentRequests`
  - `isOperatorComment`
  - `isOwnPost`
  - `videoIds.length === 0`

検証:

- 接続成功後に古い `Content Script communication failed` が残らない。
- 生主コメントから `sm9` を送った場合は operator/own post skip と表示される。
- 受付 OFF の場合は acceptance skip と表示される。

### Step 2: messageServer 正規化

目的:

- 現行ページの data shape 揺れに強くする。

変更候補:

- `src/sidepanel/services/nicoLiveCommentProvider.ts`
  - `normalizeMessageServerViewUri(msg)` を追加。
  - `viewUri` と `uri`、`room` ネストを探索する。

検証:

- 既存ログと同じ番組で `viewUri` が取れる。
- debug event に取得 path が出る。

### Step 3: backward / previous segment を限定取得

目的:

- 接続直前・接続直後のテストコメント取り逃しを減らす。

変更候補:

- `src/sidepanel/services/nicoLiveCommentProvider.ts`
  - `seenSegmentUris` を追加。
  - `backlogSegmentCount` と上限を追加。
  - `entry.backwardUri` / `entry.previousUri` も限定的に `streamChunkedMessages` へ渡す。

注意:

- 無制限 backlog 読み込みは禁止。
- 重複コメント登録を避けるため、既存の `seenChunkedMessageIds` / `seenCommentKeys` は維持する。

検証:

- 接続直後に `sm9` を視聴者コメントとして投稿して、`comment` -> `video_id_extract` -> `video_info` -> `request_add` が進む。

### Step 4: Chat field debug

目的:

- `a:yFoT-eEGfI5YRHFh` のような値が本当に本文なのか確認する。

変更候補:

- `src/sidepanel/services/ndgrCodec.ts`
  - debug build 用に `DecodedChat` に `stringFields?: Record<number, string>` を持たせる。
  - field 4/5/6/7 以外の string field も preview できるようにする。

- `src/sidepanel/services/nicoLiveCommentProvider.ts`
  - `handleDecodedMessage` で `msg.chat.content` が動画IDを含まない場合、string field preview を debug event に出す。

注意:

- preview は最大80文字程度。
- token / Cookie / URL query は出さない。

検証:

- `sm9` 投稿時に field 6 以外に `sm9` が入っていないか確認する。

### Step 5: frontend_id 付与

目的:

- watch WS 接続の互換性を上げる。

変更候補:

- `src/content/nicoliveContentScript.ts`
  - `site.frontendId` を読む。
- `src/shared/types.ts`
  - `NicoliveContext.frontendId` を追加。
- `src/sidepanel/hooks/useCommentProvider.ts` または provider
  - `webSocketUrl` に `frontend_id` を付与。

優先度:

- 現在 watch WS は接続できているため、Step 1-4 の後でよい。

## 7. 実装時に壊してはいけないこと

- 自動再生:
  - `src/sidepanel/hooks/usePlaybackController.ts`
  - `findNextPlayableRequest()` と `forcePlay()` の挙動を変えない。

- 手動強制再生:
  - `VideoCard` / `App.tsx` から `forcePlay()` される流れを変えない。

- 動画情報取得:
  - `src/shared/nicoVideoApi.ts`
  - `fetchNicoVideoInfo()` の戻り値 shape を変えない。

- リクエスト保存:
  - `src/storage/videoRepository.ts`
  - `addVideo("request", draft)` の duplicate handling を変えない。

- operator comment skip:
  - 生主コメントをリクエストとして受け付ける仕様変更は今回しない。
  - まずは「スキップ理由の可視化」だけ行う。

## 8. 推奨検証手順

### 8.1 ビルド

```powershell
npm run build
```

### 8.2 Chrome 拡張で確認

1. `npm run build` 後、Chrome の拡張機能ページで `dist` を読み込む。
2. `https://live.nicovideo.jp/watch/lv...` を開く。
3. side panel を開く。
4. コメント接続を開始する。
5. debug panel で以下を確認する。
   - embedded-data: YES
   - WebSocket URL candidate: 1件以上
   - watch WebSocket: open
   - startWatching: 1以上
   - seat: 1以上
   - keepSeat: 増える
   - messageServer: 1以上
   - viewUri: URLあり
   - message stream open: 1以上
   - decode_ok: 増える

### 8.3 視聴者コメントテスト

重要:

- 生主コメントではなく、視聴者コメントとして投稿する。
- 可能なら別アカウントまたは別ブラウザで投稿する。

テストコメント:

```text
sm9
```

期待:

1. debug panel の `コメント受信件数` が増える。
2. `最新コメント` に `sm9` または `sm9` を含む本文が出る。
3. `動画ID抽出結果` が success。
4. `抽出された動画ID` が `sm9`。
5. `動画情報取得` が success。
6. `リクエスト登録` が success。
7. Request tab に `sm9` が追加される。

### 8.4 失敗時の読み方

- コメント受信件数が増えない:
  - watch WS / viewUri / stream / decode / backward previous 取得を疑う。

- コメント受信件数は増えるが `最新コメント` が `sm9` でない:
  - 投稿タイミングまたは backlog 未取得を疑う。
  - 本当に視聴者コメントとして投稿しているか確認する。

- `最新コメント` に `sm9` が出るが抽出失敗:
  - `extractVideoIdsFromComment` の regex を疑う。

- 抽出成功だが動画情報取得失敗:
  - `fetchNicoVideoInfo` / ネットワーク / `ext.nicovideo.jp` を疑う。

- 動画情報取得成功だが登録失敗:
  - duplicate、NG、IndexedDB、`addVideo` を疑う。

- operator/own post skip:
  - 生主コメント欄から投稿している可能性が高い。

## 9. 変更差分方針

最初の PR / patch は小さくする。

推奨する最初の差分:

1. `useCommentDebug` に stale error clear と request skip debug を追加。
2. `useCommentToRequest` の early return に debug 記録を追加。
3. `nicoLiveCommentProvider` の `messageServer` viewUri 正規化を強化。

次の差分:

4. `backwardUri` / `previousUri` の限定取得。
5. `Chat` string field debug。
6. `frontend_id` 付与。

避けること:

- 最初から background service worker へコメント取得処理を大移動しない。
- `usePlaybackController` や `videoRepository` の大規模 refactor をしない。
- console log のみで切り分けを終えない。debug panel に出す。
- token / csrfToken / Cookie を debug panel や console に出さない。

## 10. 作業ログ追記欄

以降のエージェントは、作業ごとにこの欄へ追記する。

### 2026-05-27 初期指示

- `docs/nico-pong-debug-log.md` の内容をもとに、現在の到達点と疑うべき箇所を整理した。
- まず stale error と early return の可視化を優先する。
- 次に messageServer 正規化と backlog segment 限定取得を行う。
- 最終確認は視聴者コメント `sm9` が Request tab に入ること。

---

## Version 0.3.7 での実装内容と方針と考察

実装日: 2026-05-27  
ビルド: `npm run build` で TypeScript エラーなし、ビルド成功を確認。

### 実装内容 (Step 1〜4)

#### Step 1: stale error 解消とスキップ理由の可視化

**`src/sidepanel/hooks/useCommentDebug.ts`**

- `CommentDebugActions` 型に `clearError(): void` を追加。
- `clearError` 実装: `setState((prev) => ({ ...prev, lastError: undefined }))` で stale error を解消。
- `recordEvent` の `decode_fail` case を `if (!next.lastError)` ガードなしに変更 → 常に最新 decode エラーを反映する。
- `recordEvent` に `request_add` case を追加 → `ok=false` のとき `lastError` に記録。早期 return のスキップ理由をデバッグパネルへ反映。

**`src/sidepanel/hooks/useCommentProvider.ts`**

- `CommentProviderDebugSink` 型に `clearError?: () => void` を追加。
- `connect()` 開始時の冒頭で `debugRef.current?.clearError?.()` を呼ぶ → 再接続後に古い Content Script 通信失敗メッセージが残らない。

**`src/sidepanel/App.tsx`**

- `useCommentProvider` の `debugSink` オブジェクトに `clearError: commentDebugActions.clearError` を追加。

**`src/sidepanel/hooks/useCommentToRequest.ts`**

- `handleComment` の 4 つの早期 return 直前に `deps.debug?.recordEvent?.()` を追加:
  - `requestAcceptMode !== "accept"` → `skip: requestAcceptMode=<値>`
  - `!autoAcceptCommentRequests` → `skip: autoAcceptCommentRequests=false`
  - `isOperatorComment === true` → `skip: operator comment`
  - `isOwnPost === true` → `skip: own post`
- いずれも `stage: "request_add", ok: false` として記録。

#### Step 2: messageServer / viewUri 正規化強化

**`src/sidepanel/services/nicoLiveCommentProvider.ts`**

- モジュールレベルに `normalizeMessageServerViewUri(data: unknown): { viewUri: string | undefined; path: string | undefined }` を追加。
- 以下 6 パスを優先順に探索:
  1. `data.viewUri`
  2. `data.messageServer.viewUri`
  3. `data.messageServer.uri`
  4. `data.room.viewUri`
  5. `data.room.messageServer.viewUri`
  6. `data.room.messageServer.uri`
- `handleWebSocketMessage` で `messageServer` / `room` メッセージ受信時に `normalizeMessageServerViewUri(data)` を使用し、`viewUri` と `path` を取得。
- debug event の detail に `resolvedPath` と `keys` を追加し、取得パスを記録。

#### Step 3: backward / previous segment の限定取得

**`src/sidepanel/services/nicoLiveCommentProvider.ts`**

- クラスフィールドに `seenSegmentUris = new Set<string>()` と `backlogSegmentCount = 0` を追加。
- `static readonly MAX_BACKLOG_SEGMENTS = 3` を追加。
- `connect()` でリセット: `seenSegmentUris.clear()`, `backlogSegmentCount = 0`。
- `pullSegmentOnce(uri, reason: "live" | "backward" | "previous")` を追加:
  - `seenSegmentUris` で重複 URI をスキップ。
  - `AbortController` を作って `streamChunkedMessages` を非同期で呼ぶ。
- `streamChunkedEntry` のエントリ処理ループを更新:
  - `entry.segmentUri` → `pullSegmentOnce(uri, "live")`
  - `entry.backwardUri` → `backlogSegmentCount < MAX_BACKLOG_SEGMENTS` の場合のみ `pullSegmentOnce(uri, "backward")`
  - `entry.previousUri` → 同様に `pullSegmentOnce(uri, "previous")`
- `streamChunkedMessages` のシグネチャに `reason: "live" | "backward" | "previous" = "live"` を追加し、debug event の label/reason に反映。

#### Step 4: Chat field debug

**`src/sidepanel/services/ndgrCodec.ts`**

- `DecodedChat` に `source?: string` (field 1) と `debugStringFields?: Record<number, string>` を追加。
- `decodeChat()` を更新:
  - field 1 (wire type 2 / string) → `source` として読む。
  - field 9 (modifier, wire type 2) → skip。
  - それ以外の wire type 2 フィールドで未知のものは `debugStringFields[fieldNo]` に 80 文字 preview を入れる。

**`src/sidepanel/services/nicoLiveCommentProvider.ts`**

- `handleDecodedMessage` の chat 処理内で、`extractVideoIdsFromComment(content)` が 0 件かつ `debugStringFields` または `source` が存在する場合に `emitDebug("comment", ...)` で field 構造を出力。
  - source, contentPreview, debugStringFields を detail に含める。
  - 個人情報・token は含めない。

### 方針のまとめ

- stale error の解消を最優先とした。再接続のたびに古いエラーが残ると「動いているのに壊れている」ように見えるため、切り分けの前提として必須。
- early return のスキップ理由可視化: デバッグパネルを見るだけで「なぜ登録されないか」が分かるようにする。生主コメントから投稿した場合の operator skip も記録される。
- messageServer 正規化: 現行ログでは問題なかったが、今後の番組や reconnect 後の data shape 変化に対応するため先行実装。
- backward/previous 取得: 接続直前・直後のテストコメントを拾い逃す主因と考えられるため実装。上限 3 件で無制限 backlog は避ける。
- Chat field debug: `a:yFoT-eEGfI5YRHFh` のような短いコメントが field 6 以外に本文を持っていないか確認するため追加。Step 4 は観測ツールであり、フィールド番号の変更などは行っていない。

### 未実施 (Step 5)

- `frontend_id` 付与: 現行では watch WS 接続が成功しているため今回は見送り。Step 1〜4 の確認後、問題が残る場合に実施する。

### 考察と残存リスク

1. **operator / own post スキップ**: 生主アカウントで `sm9` を視聴者コメント欄から送れない場合、別アカウントや別ブラウザによるテストが必要。デバッグパネルに skip 理由が出るので判別可能になった。

2. **acceptance 設定**: `requestAcceptMode !== "accept"` または `autoAcceptCommentRequests=false` でスキップされる場合も debug event で見えるようになった。接続前に設定を確認しやすくなった。

3. **backward/previous の効果検証**: 接続から最初の `at=now` レスポンスまでに backward/previous URI が届く場合、上限 3 件の制限内でテストコメントを拾えるはず。ただし接続タイミングが悪い場合は今後上限を引き上げる必要があるかもしれない。

4. **Chat field 6 以外に本文がある可能性**: デバッグパネルのイベントログで `source` / `debugStringFields` を確認することで、実際にどの field が使われているかを判断できる。もし field 6 が誤りで field 7 や field 4 が本文ならば、次の iteration で `decodeChat` の field 番号を修正する。

5. **ビルドサイズ**: sidepanel bundle が 380KB (gzip 120KB) で前バージョンから大きな変化なし。protobufjs の manual reader 実装の影響は軽微。

---

## 追加修正 2026-05-27 19:07:46 JST

### 今回の追加ログ

ユーザー報告の debug panel 状態:

```text
messageServer 受信回数: 2
最後の viewUri: https://mpn.live.nicovideo.jp/api/view/v4/...
message stream open 回数: 26
protobuf decode 成功回数: 31
protobuf decode 失敗回数: 0

直近 NDGR fetch:
label: segment
?at= 渡し値: 1779876178
HTTP status: 200
Content-Type: application/octet-stream
受信総バイト数: 135
先頭バイト hex:
segment first bytes (213B): 87 01 0a 40 0a 26 45 68 6f 4b ...

コメント -> リクエスト pipeline:
コメント監視状態: 監視中
コメント受信件数: 2
最後の受信時刻: 19:02:19
最後のコメント: a:yFoT-eEGfI5YRHFh
投稿者: EhoKEgl5fo1y4mieARH0B9I_kObxqhClh4_dBA
動画ID抽出結果: 失敗
抽出された動画ID: -
動画情報取得: 未実行
リクエスト登録: 未実行
動画ID判定成功件数: 0
リクエスト登録成功件数: 0
最後のエラー: -
```

### 追加結論

今回のログでは、watch WebSocket、messageServer、viewUri、NDGR fetch、protobuf decode は正常に進んでいる。最後のエラーが `-` なのも妥当で、現在の停止箇所は例外ではなく「動画ID抽出に渡されるコメント本文が誤っている」こと。

最重要の原因候補は **NDGR `Chat` の field 番号誤り**。

現在の実装では `src/proto/ndgr.proto` と `src/sidepanel/services/ndgrCodec.ts` が概ね以下のように扱っている。

```proto
message Chat {
  string source = 1;
  int32 no = 2;
  int32 vpos = 3;
  string name = 4;
  string hashedUserId = 5;
  string content = 6;
  string rawUserId = 7;
  int32 accountStatus = 8;
}
```

しかし公開されている NDGR Chat protobuf 生成情報では `Chat` は以下の field 配置になっている。

```text
content        = field 1, bytes/string
name           = field 2, bytes/string, optional
vpos           = field 3, varint/int32
account_status = field 4, varint/enum
raw_user_id    = field 5, varint/int64, optional
hashed_user_id = field 6, bytes/string, optional
modifier       = field 7, bytes/message
no             = field 8, varint/int32
```

参照:

- https://pkg.go.dev/github.com/shinosaki/nicolive-comment-protobuf/proto/dwango/nicolive/chat/data
- `type Chat struct` に `Content protobuf:"bytes,1"`、`HashedUserId protobuf:"bytes,6"`、`No protobuf:"varint,8"` とある。

この対応関係なら、現在 UI に出ている `最後のコメント: a:yFoT-eEGfI5YRHFh` は本文ではなく `hashed_user_id` を `content` として誤読している状態と説明できる。

また、`投稿者: EhoKEgl5fo1y4mieARH0B9I_kObxqhClh4_dBA` は `Chat.hashedUserId` ではなく `meta.id` fallback が入っている可能性が高い。現在の provider は `msg.chat.hashedUserId || msg.chat.rawUserId || msg.meta?.id` を userId にしているため、field 6 を content として読んでしまうと `hashedUserId` が空になり、meta id が投稿者欄に出る。

### 修正すべきこと

次のエージェントは、最優先で `Chat` decoder の field mapping を修正すること。backward/previous や request skip debug よりも、この修正が今回ログに対する本命。

対象:

- `src/proto/ndgr.proto`
- `src/sidepanel/services/ndgrCodec.ts`
- 必要なら `src/sidepanel/services/nicoLiveCommentProvider.ts`

#### 1. `src/proto/ndgr.proto` の Chat 定義を正しい field 番号に直す

修正案:

```proto
message Chat {
  string content = 1;          // 本文
  optional string name = 2;    // 名札
  int32 vpos = 3;
  int32 accountStatus = 4;     // 0=STANDARD, 1=PREMIUM
  optional int64 rawUserId = 5;
  optional string hashedUserId = 6;
  ChatModifier modifier = 7;   // 詳細 decode しないなら message 定義だけでよい
  int32 no = 8;
}
```

この `.proto` は現在ランタイム decode には使っていないが、今後の混乱防止のため必ず直す。

`ChatModifier` は詳細に使わないなら最小定義でよい。manual decoder では skip してもよい。

#### 2. `src/sidepanel/services/ndgrCodec.ts` の `decodeChat()` を修正する

現在の誤り:

- field 1 を `source` として読んでいる。
- field 2 を `no` として読んでいる。
- field 4 を `name` として読んでいる。
- field 5 を `hashedUserId` として読んでいる。
- field 6 を `content` として読んでいる。
- field 7 を `rawUserId` string として読んでいる。
- field 8 を `accountStatus` として読んでいる。

正しい mapping:

```ts
function decodeChat(r: protobuf.Reader, end: number): DecodedChat {
  const result: DecodedChat = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;

    if (f === 1 && w === 2) result.content = r.string();
    else if (f === 2 && w === 2) result.name = r.string();
    else if (f === 3 && w === 0) result.vpos = r.int32();
    else if (f === 4 && w === 0) result.accountStatus = r.int32();
    else if (f === 5 && w === 0) result.rawUserId = int64Str(r);
    else if (f === 6 && w === 2) result.hashedUserId = r.string();
    else if (f === 7 && w === 2) {
      const len = r.uint32();
      r.pos += len; // modifier は現時点では未使用
    } else if (f === 8 && w === 0) result.no = r.int32();
    else r.skipType(w);
  }
  return result;
}
```

`DecodedChat` 型も合わせて更新する。

```ts
export type DecodedChat = {
  content?: string;
  name?: string;
  vpos?: number;
  accountStatus?: number;
  rawUserId?: string;
  hashedUserId?: string;
  no?: number;
  debugStringFields?: Record<number, string>;
};
```

`source?: string` は不要。残す場合でも field 1 には割り当てないこと。field 1 は本文。

#### 3. `rawUserId` は string field ではなく int64 varint として読む

現在 `rawUserId` を `r.string()` で読んでいるなら誤り。正しくは field 5 / wire type 0 の int64。

```ts
else if (f === 5 && w === 0) result.rawUserId = int64Str(r);
```

#### 4. `no` は field 8 として読む

現在 field 2 を `no` として読んでいる場合、コメント番号が不正になる。重複排除 key に `no` を使っているため、正しい field 8 に直す。

```ts
else if (f === 8 && w === 0) result.no = r.int32();
```

#### 5. `debugStringFields` は誤読の温床にしない

Step 4 で `debugStringFields` を追加済みなら残してよいが、既知 field は正しい mapping で消費すること。特に field 1 は debug unknown string ではなく `content` として読む。

未知 field の preview は次のような扱いでよい。

```ts
else if (w === 2) {
  const value = r.string();
  if (!result.debugStringFields) result.debugStringFields = {};
  result.debugStringFields[f] = value.slice(0, 80);
}
```

ただし field 7 `modifier` は nested message なので `r.string()` で読まない。length を読んで skip する。

### 期待される修正後の表示

視聴者が `sm9` とコメントした場合:

```text
最後のコメント: sm9
投稿者: a:yFoT-eEGfI5YRHFh  または hashed user id
動画ID抽出結果: 成功
抽出された動画ID: sm9
動画情報取得: 成功
リクエスト登録: 成功
```

現在とは逆に、`a:yFoT...` は投稿者 ID 側に入り、本文には `sm9` が入るはず。

### 検証手順

1. `decodeChat()` の mapping を修正する。
2. `npm run build` を実行する。
3. 拡張を読み込み直す。
4. ニコ生ページを再読み込みする。
5. side panel でコメント接続する。
6. 別アカウントまたは別ブラウザから視聴者コメントとして `sm9` を投稿する。
7. debug panel で以下を確認する。

```text
コメント受信件数: 増える
最後のコメント: sm9
投稿者: a:... または hashed user id
動画ID抽出結果: 成功
抽出された動画ID: sm9
動画情報取得: 成功
リクエスト登録: 成功
最後のエラー: -
```

### 失敗した場合の次の切り分け

#### A. 最後のコメントがまだ `a:...` の場合

`decodeChat()` の field mapping がまだ誤っている、または修正後 bundle が Chrome に読み込まれていない。

確認:

- `dist` を再読み込みしたか。
- `src/sidepanel/services/ndgrCodec.ts` の field 1 が `content` になっているか。
- field 6 が `hashedUserId` になっているか。

#### B. 最後のコメントが `sm9` だが動画ID抽出失敗

`src/shared/commentParsing.ts` の regex を確認する。現在の設計では `sm9` は拾えるはず。

#### C. 動画ID抽出成功だが動画情報取得未実行

`useCommentToRequest` の early return skip を見る。

- `requestAcceptMode !== "accept"`
- `autoAcceptCommentRequests=false`
- `operator comment`
- `own post`

#### D. 動画情報取得成功だが登録未実行

`request_add` の debug event を見る。

- duplicate
- NG
- IndexedDB error
- `addVideo("request", draft)` 例外

### 優先度の更新

次回作業の優先順位を以下に変更する。

1. NDGR `Chat` field mapping 修正。最優先。
2. `npm run build`。
3. 視聴者コメント `sm9` で確認。
4. まだ取り逃す場合のみ backlog 上限や previous/backward を再調整。
5. それでも不安定な場合のみ `frontend_id` 付与に進む。

今回ログでは `message stream open` と `decode_ok` は十分に進んでいるため、`frontend_id` や `viewUri` 正規化は本件の直接原因ではない可能性が高い。

---

## 修正結果 2026-05-27 19:31:23 JST

### 実施内容: NDGR `Chat` field mapping 全面修正 (v0.3.8)

ビルド: `npm run build` で TypeScript エラーなし、正常終了を確認。

#### 変更ファイル

**`src/proto/ndgr.proto`**

Chat メッセージの field 番号を正しい仕様に全面修正。

変更前:
```proto
message Chat {
  string source = 1;
  int32 no = 2;
  int32 vpos = 3;
  string name = 4;
  string hashedUserId = 5;
  string content = 6;
  string rawUserId = 7;
  int32 accountStatus = 8;
  repeated string modifier = 9;
}
```

変更後:
```proto
message Chat {
  string content = 1;              // 本文
  optional string name = 2;       // 名札
  int32 vpos = 3;
  int32 accountStatus = 4;        // 0=STANDARD, 1=PREMIUM
  optional int64 rawUserId = 5;   // int64 varint
  optional string hashedUserId = 6;
  ChatModifier modifier = 7;      // 未使用 (skip)
  int32 no = 8;
}
message ChatModifier {}
```

**`src/sidepanel/services/ndgrCodec.ts`**

`DecodedChat` 型から `source` を除去し、field 1 → `content`、field 8 → `no` に修正。

`decodeChat()` を以下の正しい mapping に全面書き換え:
- field 1, wire 2 → `result.content = r.string()`
- field 2, wire 2 → `result.name = r.string()`
- field 3, wire 0 → `r.int32()` (vpos skip)
- field 4, wire 0 → `result.accountStatus = r.int32()`
- field 5, wire 0 → `result.rawUserId = int64Str(r)` (int64 varint)
- field 6, wire 2 → `result.hashedUserId = r.string()`
- field 7, wire 2 → len を読んで `r.pos += len` (modifier nested message skip)
- field 8, wire 0 → `result.no = r.int32()`
- その他 wire 2 → `debugStringFields[f]` に 80 文字 preview

以前は field 7 を `r.string()` で rawUserId として読んでいたが、field 7 は nested message (wire type 2 だが length 付きバイナリ) であり、`r.string()` で読むと後続バイトが崩壊する原因になっていた。

**`src/sidepanel/services/nicoLiveCommentProvider.ts`**

`msg.chat.source` の参照を除去:
- `console.info` から `source=` ログを削除。
- chat field debug emit の条件を `msg.chat.debugStringFields` のみに変更。
- `emitDebug` の detail から `source` キーを削除。

#### 修正前後の field 誤読の対応関係

| field | 旧 (誤) | 新 (正) |
|-------|---------|---------|
| 1 | source (文字列) | **content (本文)** |
| 2 | no (int32) | name (文字列) |
| 4 | name (文字列) | accountStatus (int32) |
| 5 | hashedUserId (string) | rawUserId (int64 varint) |
| 6 | **content (本文として使用)** | hashedUserId (文字列) |
| 7 | rawUserId (string) | modifier (nested message skip) |
| 8 | accountStatus (int32) | no (int32) |

この誤りにより、UI に表示されていた `最後のコメント: a:yFoT-eEGfI5YRHFh` は **field 6 の `hashedUserId` を本文として誤読したもの**であり、実際の本文 (field 1) は捨てられていた。`投稿者: EhoKEgl5fo1y4mieARH0B9I...` は `hashedUserId` が空のため `meta.id` fallback が入っていた。

### 考察

修正後は以下の動作変化が期待される:
- `最後のコメント` に実際の投稿テキスト (`sm9` など) が入る。
- `投稿者` に `a:yFoT-eEGfI5YRHFh` 相当の hashed user id が入る。
- `コメント番号 no` が field 8 から正しく読まれるため、重複排除キー `no:userId:text` が正確になる。
- `rawUserId` が int64 varint として正しく読まれる。

なお、`modifier` (field 7) は以前 `r.string()` で読んでいたが、これは nested message バイナリを文字列として読み込もうとするものであり、`rawUserId` が意図しない値になるだけでなく、バイト位置がずれて後続フィールドが読めなくなるリスクもあった。length を読んで skip する方式に修正したため、後続の field 8 (`no`) も確実に読める。

### 残存課題

1. **視聴者コメントテスト未実施**: 修正後の実機確認は別アカウントからの視聴者コメント投稿が必要。
2. **rawUserId の表示**: field 5 が int64 varint の場合、実際のユーザー ID は数値文字列になる。userId として `hashedUserId || rawUserId || meta.id` の順で使う現行ロジックは正しい。
3. **Step 5 (frontend_id)**: 引き続き見送り。watch WS が成功しているため不要と判断。

---

## 修正履歴 2026-05-27 20:13:30 JST

### v1.0.0 リリース対応 — デバッグUI削除・ボタン修正・自動接続・設定固定化

ビルド: `npm run build` で TypeScript エラーなし、正常終了。  
モジュール数: 176 (v0.3.8 の 178 から -2、デバッグパネルコンポーネントが除外された)  
バンドルサイズ: sidepanel 365KB gzip 116KB (v0.3.8 の 380KB gzip 120KB から削減)

---

### 変更内容

#### 1. デバッグ UI の削除

**`src/sidepanel/App.tsx`**

- `import CommentDebugPanel` を削除。
- `import { useCommentDebug }` を削除。
- `const { state: commentDebugState, actions: commentDebugActions } = useCommentDebug()` を削除。
- `commentDebugActions.onCommentReceived(comment)` 呼び出しを `handleCommentReceived` から削除。
- `useCommentProvider` への debugSink オブジェクト (`recordEmbeddedIntrospection` / `recordWebSocketCandidates` / `setSelectedWebSocketUrl` / `recordEvent` / `clearError`) の渡しを削除。
- 接続状態 → デバッグウォッチャー状態マッピングの `useEffect` を削除。
- `handleComment` の `debug: commentDebugActions` 引数を削除。
- JSX から `<CommentDebugPanel ... />` を削除。

`useCommentDebug.ts`・`CommentDebugPanel.tsx` ファイル自体は将来の再利用に備えて残置（未参照）。

**`src/sidepanel/components/CommentConnectionPanel.tsx`**

- `alpha-tag` span を削除。
- `conn-hint` div（v0.2.1-alpha の説明テキスト）を削除。
- 1.0.0 として正式リリースのため alpha 表記を排除。

---

#### 2. 接続ボタンのスタイル修正

**`src/sidepanel/styles.css`**

`.conn-header button` の旧スタイル:
```css
border: 1px solid #ccc;
background: #f4f4f4;
/* color 未指定 */
```

ダークモード時、`:root` の `color: #e8e8e8` (ほぼ白) が継承され、`#f4f4f4` (薄グレー) 背景に白文字となり視認不能になっていた。

新スタイル:
```css
padding: 4px 12px;
font-size: 12px;
border: 1px solid #218a3a;
background: #28a745;
color: #000;
border-radius: 4px;
cursor: pointer;
font-weight: 600;
```

- 背景色を緑 (`#28a745`)、文字色を黒 (`#000`) に固定。
- ライト・ダークモード双方で視認性を確保。
- 「接続開始」・「停止」ボタン双方に適用。
- パディングとフォントサイズをわずかに拡大して押しやすさを改善。

---

#### 3. 起動時自動接続

**`src/sidepanel/App.tsx`**

以下の `useEffect` を追加:
```tsx
useEffect(() => {
  void connectComment();
}, [connectComment]);
```

- サイドパネルが開かれたタイミングで `connect()` を自動的に呼び出す。
- `connectComment` は `useCommentProvider` 内の `useCallback([], [])` で安定した参照のため、初回マウント時に一度だけ実行される。
- ニコ生番組タブが開いていない場合は `status: "error"` に遷移するが、ユーザーがタブを開いて「接続開始」ボタンを押すことで再試行できる。
- 手動切断後は自動再接続しない（`useEffect` は再実行されないため）。

---

#### 4. コメント自動追加・重複防止の固定化とメニューからの削除

**`src/sidepanel/hooks/useRequestAcceptance.ts`**

設定ロード時と `update()` 呼び出し時に、以下を常に `true` に上書き:
```ts
{ ...s, autoAcceptCommentRequests: true, preventDuplicateInRequest: true }
```

- 過去に `false` を保存していたユーザーでもロード時に `true` に矯正される。
- `update()` 経由でも `false` に変更できない。

**`src/sidepanel/components/CommentConnectionPanel.tsx`**

- 「コメントから自動追加」チェックボックスを削除。
- 「重複防止」チェックボックスを削除。
- 残存する UI: 「リクエスト受付」チェックボックス・「1人あたり最大」数値入力。

`DEFAULT_REQUEST_ACCEPTANCE_SETTINGS`（`src/shared/types.ts`）の値はすでに両フィールドとも `true` であり変更不要。

---

#### 5. バージョン更新

| ファイル | 変更前 | 変更後 |
|---------|--------|--------|
| `src/shared/constants.ts` | `"0.3.8"` | `"1.0.0"` |
| `public/manifest.json` | `"0.3.8"` | `"1.0.0"` |
| `package.json` | `"0.3.8"` | `"1.0.0"` |

---

### 考察

#### デバッグ UI 削除の影響

`useCommentDebug`・`CommentDebugPanel` は削除ではなく未参照状態で残置。これにより:
- バンドルから tree-shake で除外され、サイズが削減された。
- 将来のトラブル時に `App.tsx` へ import を戻すだけで即座に復活できる。

デバッグ情報が必要な場合は引き続き `console.info/warn` ログ (`[nico-pong]` プレフィックス) を参照可能。

#### 自動接続の設計

自動接続が失敗した場合（ニコ生タブ未開、content script 未注入など）は `commentStatus === "error"` になる。ユーザーはタブを開いて手動で「接続開始」ボタンを押せば再接続できる。自動リトライは実装しなかった（UX として「失敗したら手動で開始」が明確であるため）。

#### 重複防止の固定化

`preventDuplicateInRequest: true` の固定により、同一動画IDのリクエストが UI 経由でも重複して追加されない。`allowDuplicate: !acceptance.preventDuplicateInRequest` の評価結果は常に `false` (= 重複不可) になる。

---

### 残存課題

1. 自動接続失敗時のエラー表示: `commentStatus === "error"` になるが、エラーメッセージがパネルに表示されるため問題なし。
2. 「停止」ボタンも緑色になっているが、直感的には赤や橙が好ましい可能性がある。必要に応じて個別にスタイルを調整すること。
