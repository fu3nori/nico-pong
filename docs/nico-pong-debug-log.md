# nico-pong デバッグログ (v0.3.5 → v0.3.6)

作成日: 2026-05-27  
担当: Claude Code (claude-sonnet-4-6)

---

## 1. これまでの障害の経緯と修正内容 (v0.3.5 まで)

### 1-1. proto ワイヤー型不一致バグ (v0.3.6 で修正済み)

**症状**  
- `message stream open 回数` が増え続けるが `protobuf decode 成功回数` = 0  
- `?at= 渡し値` が常に `now` のまま変わらない (無限ループ)  
- コメント受信件数 = 0

**原因**  
`src/proto/ndgr.proto` の `ReadyForNext.at` フィールドを `string at = 1` と定義していたが、NicoNico NDGR サーバーは実際には `int64` (varint, wire type 0) で送信していた。

```
受信 hex: 08 22 06 08 bb c1 da d0 06
           [長さ8] [field4 wire2] [6バイト] [field1 wire0 = int64 varint]
```

- `string` の期待ワイヤー型 = 2 (length-delimited)
- サーバーが送信するワイヤー型 = 0 (varint)

protobufjs は `Type.decode()` 内でこのミスマッチを検出して例外を投げるが、`decodeDelimitedStream` の `catch` が黙って飲み込んでいたため `decode_fail` カウンターも 0 のままだった。`?at` が取れないため `?at=now` のループが続いた。

**修正**  
`src/proto/ndgr.proto`: `string at = 1` → `int64 at = 1`  
`src/sidepanel/services/ndgrCodec.ts`: normalizer で Long / number / string の全型を処理

---

### 1-2. CSP 違反 (unsafe-eval) バグ (v0.3.6 で修正済み)

**症状**  
proto ワイヤー型を `int64` に修正した後、今度は別のエラーが出た:

```
最後のエラー: ChunkedEntry decode失敗 1件: 
Evaluating a string as JavaScript violates the following Content Security 
Policy directive because 'unsafe-eval' is not an allowed source of script: 
script-src 'self'"
```

**原因**  
protobufjs の `Type.decode()` / `Type.decodeDelimited()` は初回呼び出し時に内部で `@protobufjs/codegen` を呼び出す。`codegen` は `new Function(...)` を使って高速デコーダを動的生成する。

Chrome 拡張 Manifest V3 は `unsafe-eval` を完全に禁止しているため、この `new Function()` が CSP エラーになる。

- proto ワイヤー型が `string` だった時代は、例外が先に発生して `new Function()` まで到達しなかった可能性がある
- `int64` に直した結果、デコードが進んで初めて `Type.decode()` の codegen フェーズに到達し、CSP 違反が露見した

**修正**  
`ndgrCodec.ts` を全面書き直し。  
- `import protobuf from "protobufjs"` のうち `protobuf.Reader` だけを使用
- `Type.decode()` / `Type.decodeDelimited()` を完全廃止
- `Reader.uint32()`, `Reader.int64()`, `Reader.string()`, `Reader.int32()`, `Reader.skipType()` を使い、フィールド番号を手動でディスパッチする直接デコーダに置き換えた
- `codegen` / `new Function()` は一切呼ばれない

`.proto` ファイルはランタイム参照をやめたため `?raw` インポートも削除。スキーマドキュメントとして残存。

---

## 2. v0.3.6 動作確認セッション (2026-05-27) のデバッグパネル状態

```
番組ID: lv350620950
WebSocket 状態: 接続済
startWatching 送信: 1
seat 受信: 1
keepSeat 送信: 4
messageServer 受信: 1
最後の viewUri: https://mpn.live.nicovideo.jp/api/view/v4/...
message stream open: 10
protobuf decode 成功: 14   ← 修正により正常稼働
protobuf decode 失敗: 0
label: segment
?at=: 1779870015            ← "now" から実タイムスタンプに進んでいる
HTTP status: 200
受信総バイト数: 3
コメント受信件数: 1
最後のコメント: a:yFoT-eEGfI5YRHFh
動画ID抽出結果: 失敗
最後のエラー: Content Script通信失敗: Could not establish connection. Receiving end does not exist.
```

---

## 3. 現在確認された不具合と考察

### 3-1. "Content Script通信失敗" エラーの表示 (stale error 問題)

**症状**  
デバッグパネルの「最後のエラー」に `Content Script通信失敗: Could not establish connection. Receiving end does not exist.` が表示されているが、WebSocket は接続済でデコードも正常動作している。

**発生箇所**  
`src/sidepanel/hooks/useCommentProvider.ts` の `fetchNicoliveContext()`:

```ts
// useCommentProvider.ts:47
const res = await chrome.tabs.sendMessage(tabId, {
  type: MSG_GET_NICOLIVE_CONTEXT,
});
// ...
} catch (e) {
  return {
    ok: false,
    errorMessage: e instanceof Error
      ? `Content Script通信失敗: ${e.message}`
      : "Content Script通信失敗",
  };
}
```

この関数は `connect()` 冒頭で呼ばれる。失敗すると `recordEvent({ stage: "error", ... })` → `debug.lastError` がセットされ接続処理は `return` する。

**なぜ接続済なのにエラーが残るか**  
`debug.lastError` は `recordEvent` で書き込まれるが、**成功時にクリアする処理が存在しない**。  
シナリオ例:

```
1. connect() 呼び出し #1 (サイドパネル初期化直後)
   → content script まだ未注入 or ページ未ロード
   → fetchNicoliveContext() 失敗
   → debug.lastError = "Content Script通信失敗: Could not establish connection. ..."
   → status = "error" で処理終了

2. connect() 呼び出し #2 (手動で再接続 or ページロード後)
   → fetchNicoliveContext() 成功
   → WebSocket 接続・デコード正常稼働
   → debug.lastError は更新されないまま → 旧エラーが残り続ける
```

`connect()` 内では `setError(null)` でローカルの error state はリセットされるが、`debugActions.reset()` は呼ばれないため debug.lastError が残留する。

**考察: content script が未注入になる条件**

Chrome 拡張のコンテントスクリプトは `"run_at": "document_idle"` で注入される。  
以下のタイミングで `connect()` が呼ばれると、まだコンテントスクリプトが存在しない状態になり得る:

- サイドパネルが開かれた時点でニコ生ページのタブがアクティブになっている
  - → `useCommentProvider` が mount と同時に自動 `connect()` を呼ぶ場合
  - → ページが `document_idle` に達する前に `sendMessage` が届く
- ニコ生ページを新規タブで開いた直後にサイドパネルから接続した場合
- ニコ生ページをリロード直後 (コンテントスクリプトが一瞬アンマウント)

**類似エラー源**  
`useBroadcasterComment.ts` と `usePlaybackController.ts` でも同様の `fetchNicoliveContext` → `Content Script通信失敗` のパスが存在するが、これらは特定の操作 (主コメ投稿・再生) をトリガーとするため今回は該当しないと考えられる。

---

### 3-2. コメントから動画IDがリクエスト欄に反映されない問題

**症状**  
コメント受信件数 = 1、最後のコメント = `a:yFoT-eEGfI5YRHFh`、動画ID抽出結果 = 失敗。  
ユーザーが動画IDを含むコメントをリクエストしたが、リクエスト欄に追加されなかった。

**考察 A: 受信したコメントに動画IDが含まれていない**

`a:yFoT-eEGfI5YRHFh` は `sm\d+` / `nm\d+` / `so\d+` のいずれにも一致しない。  
`extractVideoIdsFromComment` の正規表現パターン:

```ts
/(sm|nm|so)(\d{1,})/g
```

に対して `a:yFoT-eEGfI5YRHFh` はマッチしない → 抽出失敗は正常動作。  
ユーザーが送ったはずの動画ID付きコメントが**この1件のコメントではない**可能性が高い。

**考察 B: ユーザーのコメントが受信されなかった (タイミング問題)**

- `コメント受信件数: 1` → ストリームが生きている間に受信したコメントは1件のみ
- segment ストリームは 1 fetch あたり短命 (今回: 3B / 6420ms) で、コメントが存在する期間に限り届く
- ユーザーが動画IDを含むコメントを送ったタイミングが segment ウィンドウの外であれば受信されない
  - NDGR は「コメントが届いたタイミングの segment URI」を視聴クライアントに通知する
  - segment が届く前に書き込まれたコメントはバックログ (backward/previous) に含まれるが、
    現在の実装は `backwardUri` / `previousUri` に対するストリームを開いていない

**考察 C: 動画IDを含むコメントが operator comment として届いた可能性**

テストを行ったユーザーが番組の放送者 (生主) である場合:

- 放送者が「主コメ欄」(緑コメ) から投稿したコメントは `NicoliveState → Marquee → MarqueeDisplay → OperatorComment` として届く
- `isOperatorComment: true` がセットされる
- `useCommentToRequest.handleComment` は先頭で `if (comment.isOperatorComment === true) return;` してスキップ

もし動画IDを「主コメ」として投稿した場合、デコードは成功してもリクエスト登録はスキップされる。  
ただし `onCommentReceived` は呼ばれるため `receivedCount` は上がる。

**考察 D: acceptanceSettings が正しく設定されていない**

`useCommentToRequest.handleComment`:

```ts
if (deps.acceptance.requestAcceptMode !== "accept") return;
if (!deps.acceptance.autoAcceptCommentRequests) return;
```

- `requestAcceptMode` が `"accept"` 以外 (例: `"pause"`, `"reject"`)
- `autoAcceptCommentRequests` が `false`

のいずれかが成立していると、動画IDが正しく抽出されても登録処理に進まない。  
デバッグパネルには acceptance settings の状態が表示されないため、ここでの確認は困難。

**考察 E: comment `a:yFoT-eEGfI5YRHFh` の正体**

コロン区切りの短文 `a:yFoT-eEGfI5YRHFh` という内容は通常の視聴者コメントとして不自然。  
考えられる正体:

1. NicoNico の内部システムメッセージ (テスト/接続確認用)
2. 放送中のボット/自動コメント
3. `Chat.content` (field 6) が別のフィールドの内容を誤読している可能性

3 について: もし NDGR の `Chat` メッセージのフィールド番号が想定と異なる場合、  
フィールド 6 が実際には別のデータを保持している可能性がある。  
参照すべきソース: [n-air-app](https://github.com/niconicoapp/n-air-app) などの公式 .proto 定義。

---

## 4. 要確認事項 (識者への依頼)

| # | 確認項目 | 判断に必要な情報 |
|---|----------|----------------|
| 1 | NDGR `Chat.content` が field 6 であることの確認 | 公式 proto / n-air-app のスキーマ |
| 2 | `backward` / `previous` segment の URI に対してストリームを開く必要があるか | NDGR プロトコル仕様 (バックログ取得方法) |
| 3 | コメント受信テスト時の acceptance settings の状態 | ユーザーが UI を確認 |
| 4 | 動画IDを含むコメントを「主コメ」として送ったか「一般コメ」として送ったか | ユーザー確認 |
| 5 | `Content Script通信失敗` の発生タイミング | イベントログ (60件) を見て `stage: error` の時刻を確認 |

---

## 5. 既知の軽微な問題

### 5-1. debug.lastError がリセットされない

`useCommentProvider.connect()` で `setError(null)` はするが `debugActions.reset()` を呼ばない。  
stale な lastError が表示されて混乱の原因になる。

修正案: `connect()` の冒頭で `debugActions.reset()` を呼ぶ、または `debug.lastError` だけを  
クリアする `clearError()` アクションを追加する。

### 5-2. backward / previous URI のストリームが未実装

ChunkedEntry で `backwardUri` / `previousUri` を受信しても、それらの URI に対して  
`streamChunkedMessages` を開く処理が存在しない。  
接続直後の過去コメント (バックログ) が取得できない可能性がある。  
ただし、リアルタイムコメント受信には影響しない。
