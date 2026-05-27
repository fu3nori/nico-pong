# nico-pong コメント取得・リクエスト登録 切り分け実装指示書

## 目的

現在、視聴者側から動画IDをコメントしても、動画がリクエストタブに入らない。

原因が以下のどちらにあるかを切り分ける。

1. ニコ生コメントそのものを拡張機能側で拾えていない
2. コメントは拾えているが、その後の動画ID抽出・動画情報取得・リクエスト登録処理で失敗している

そのため、本番画面上にデバッグ状況表示を追加し、コメント受信からリクエスト登録までの各段階を可視化する。

---

## 前提

- Chrome拡張 `nico-pong` の既存実装に対する追加改修である。
- 既にリクエストタブ、ストックタブ、動画再生機能、テンプレートコメント送信機能は存在する。
- 今回の目的は恒久的なUI改善ではなく、原因調査用の切り分け実装である。
- ただし本番画面で確認できるようにするため、サイドパネルまたは既存UI内にデバッグ表示を追加する。

---

## 実装方針

サイドパネル、または現在の管理画面に「コメント受信デバッグ」ブロックを追加する。

このブロックには、以下の情報をリアルタイム表示する。

- コメント監視状態
- 最後に受信したコメント
- コメント投稿者情報
- 受信時刻
- 動画ID抽出結果
- 動画IDとして判定された文字列
- 動画情報取得結果
- リクエストタブ登録結果
- 最後に発生したエラー
- コメント受信件数
- 動画ID判定成功件数
- リクエスト登録成功件数

---

## 追加するUI

### 表示名

`コメント受信デバッグ`

### 表示項目

以下のような表示ブロックを追加する。

```text
コメント監視状態: 監視中 / 未接続 / エラー
コメント受信件数: 0
最後の受信時刻: -
最後のコメント: -
投稿者: -

動画ID抽出結果: 未判定 / 成功 / 失敗
抽出された動画ID: -
動画情報取得: 未実行 / 成功 / 失敗
リクエスト登録: 未実行 / 成功 / 失敗

最後のエラー: -
```

---

## 必須ログポイント

コメント処理の各段階で、画面表示と `console.log` の両方にログを出す。

### 1. コメント監視開始時

コメント取得処理が開始された時点で以下を表示する。

```text
コメント監視状態: 監視中
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] comment watcher started');
```

---

### 2. コメント受信時

コメントを1件でも受信したら、以下を更新する。

```text
コメント受信件数: +1
最後の受信時刻: 現在時刻
最後のコメント: 受信したコメント本文
投稿者: userId / nickname / handleName など取れる情報
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] comment received', commentPayload);
```

ここでログが出ない場合は、コメント取得処理そのものが失敗していると判断できる。

---

### 3. 動画ID抽出前

コメント本文を動画ID判定に渡す直前にログを出す。

```js
console.log('[nico-pong][comment-debug] before video id parse', {
  text: commentText,
});
```

---

### 4. 動画ID抽出成功時

`sm12345678`、`nm12345678`、`so12345678`、`lv12345678`、URL内動画IDなどを検出できた場合、以下を更新する。

```text
動画ID抽出結果: 成功
抽出された動画ID: sm12345678
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] video id parsed', {
  videoId,
  originalText: commentText,
});
```

---

### 5. 動画ID抽出失敗時

コメントは受信できたが動画IDが見つからない場合、以下を更新する。

```text
動画ID抽出結果: 失敗
抽出された動画ID: -
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] no video id found', {
  originalText: commentText,
});
```

ここまで表示される場合、コメント取得は成功しており、動画ID抽出ロジック側の問題である可能性が高い。

---

### 6. 動画情報取得開始時

動画ID抽出後、動画情報を取得する直前に以下を表示する。

```text
動画情報取得: 実行中
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] fetching video info', {
  videoId,
});
```

---

### 7. 動画情報取得成功時

動画タイトル、作者名、URLなどが取れた場合、以下を表示する。

```text
動画情報取得: 成功
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] video info fetched', videoInfo);
```

---

### 8. 動画情報取得失敗時

動画情報取得に失敗した場合、以下を表示する。

```text
動画情報取得: 失敗
最後のエラー: エラー内容
```

コンソールにも出す。

```js
console.error('[nico-pong][comment-debug] failed to fetch video info', error);
```

---

### 9. リクエストタブ登録前

動画情報取得後、リクエストタブへ登録する直前にログを出す。

```js
console.log('[nico-pong][comment-debug] before add request', {
  videoId,
  videoInfo,
});
```

---

### 10. リクエストタブ登録成功時

リクエストタブへ追加できた場合、以下を更新する。

```text
リクエスト登録: 成功
リクエスト登録成功件数: +1
```

コンソールにも出す。

```js
console.log('[nico-pong][comment-debug] request added', {
  videoId,
  videoInfo,
});
```

---

### 11. リクエストタブ登録失敗時

登録に失敗した場合、以下を表示する。

```text
リクエスト登録: 失敗
最後のエラー: エラー内容
```

コンソールにも出す。

```js
console.error('[nico-pong][comment-debug] failed to add request', error);
```

---

## デバッグ状態の保持

デバッグ表示用に、以下のような状態オブジェクトを持たせる。

```ts
type CommentDebugState = {
  watcherStatus: 'idle' | 'watching' | 'error';
  receivedCount: number;
  parsedVideoIdCount: number;
  requestAddedCount: number;
  lastReceivedAt?: string;
  lastCommentText?: string;
  lastUserId?: string;
  lastUserName?: string;
  lastParseStatus: 'not_checked' | 'success' | 'failed';
  lastVideoId?: string;
  lastVideoInfoStatus: 'not_started' | 'fetching' | 'success' | 'failed';
  lastRequestStatus: 'not_started' | 'success' | 'failed';
  lastError?: string;
};
```

---

## 画面表示用の最低限の実装例

既存の状態管理方式に合わせて実装すること。
以下は概念例であり、既存構成に合わせて書き換えてよい。

```tsx
function CommentDebugPanel({ state }: { state: CommentDebugState }) {
  return (
    <section className="debug-panel">
      <h3>コメント受信デバッグ</h3>
      <dl>
        <dt>コメント監視状態</dt>
        <dd>{state.watcherStatus}</dd>

        <dt>コメント受信件数</dt>
        <dd>{state.receivedCount}</dd>

        <dt>最後の受信時刻</dt>
        <dd>{state.lastReceivedAt ?? '-'}</dd>

        <dt>最後のコメント</dt>
        <dd>{state.lastCommentText ?? '-'}</dd>

        <dt>投稿者</dt>
        <dd>{state.lastUserName ?? state.lastUserId ?? '-'}</dd>

        <dt>動画ID抽出結果</dt>
        <dd>{state.lastParseStatus}</dd>

        <dt>抽出された動画ID</dt>
        <dd>{state.lastVideoId ?? '-'}</dd>

        <dt>動画情報取得</dt>
        <dd>{state.lastVideoInfoStatus}</dd>

        <dt>リクエスト登録</dt>
        <dd>{state.lastRequestStatus}</dd>

        <dt>動画ID判定成功件数</dt>
        <dd>{state.parsedVideoIdCount}</dd>

        <dt>リクエスト登録成功件数</dt>
        <dd>{state.requestAddedCount}</dd>

        <dt>最後のエラー</dt>
        <dd>{state.lastError ?? '-'}</dd>
      </dl>
    </section>
  );
}
```

---

## 動画ID抽出で確認したい入力パターン

最低限、以下のコメントでテストする。

```text
sm9
sm12345678
nm12345678
so12345678
https://www.nicovideo.jp/watch/sm12345678
www.nicovideo.jp/watch/sm12345678
この曲お願いします sm12345678
sm12345678 お願いします
```

`sm9` は桁数が短いが、ニコニコの実在する古い動画IDなので、桁数固定で弾かないこと。

---

## 想定される切り分け結果

### A. コメント受信件数が増えない

原因候補:

- content script がニコ生ページに注入されていない
- コメント取得対象のDOMまたはWebSocket監視箇所が間違っている
- ニコ生側のコメント構造が想定と違う
- Manifest V3 の権限不足
- 対象URLの `matches` が不足している
- sidepanel と content script の message passing が失敗している

この場合は、コメント取得処理そのものを優先して修正する。

---

### B. コメントは表示されるが動画ID抽出が失敗する

原因候補:

- 正規表現が `sm` 以外に対応していない
- `sm9` のような短いIDを弾いている
- URL形式に対応していない
- コメント本文の取得フィールドが想定と違う
- コメント本文に不可視文字や装飾情報が混ざっている

この場合は、動画ID抽出関数を修正する。

---

### C. 動画ID抽出は成功するが動画情報取得が失敗する

原因候補:

- ニコニコ動画情報APIまたはスクレイピング処理が失敗している
- Cookie / セッション / CORS / 権限の問題
- `host_permissions` が不足している
- 取得関数に渡しているID形式が不正

この場合は、動画情報取得処理を修正する。

---

### D. 動画情報取得は成功するがリクエスト登録に失敗する

原因候補:

- リクエストタブの状態更新処理が呼ばれていない
- background / sidepanel / content script 間の message passing が失敗している
- 既存の重複チェックで弾かれている
- 保存先の chrome.storage 更新に失敗している
- UI側の再描画が走っていない

この場合は、リクエスト登録処理と状態管理を修正する。

---

## 実装時の注意

- デバッグ表示は本番画面上で確認できるようにする。
- `console.log` だけに依存しない。
- ただし DevTools でも追跡できるように、必ず `console.log` / `console.error` も併用する。
- エラーは握りつぶさず、`lastError` に表示する。
- 既存機能を壊さないよう、コメント処理の本流には最小限の追加にする。
- デバッグ用コードには `[nico-pong][comment-debug]` のログ接頭辞を付ける。
- 切り分け完了後に削除しやすいよう、デバッグ関連コードは可能な限り一箇所にまとめる。

---

## 期待する完成状態

視聴者側から動画IDをコメントしたとき、本番画面上で以下が確認できる。

1. コメントが受信されたか
2. コメント本文が正しく読めているか
3. 動画IDが抽出されたか
4. 動画情報取得が成功したか
5. リクエストタブ登録が成功したか
6. どの段階で失敗しているか

これにより、現在の不具合が「コメント取得不能」なのか「取得後処理の不具合」なのかを明確に切り分けられるようにする。

---

## バージョン更新

今回の切り分け実装を追加したら、拡張機能のバージョンを上げる。

例:

```json
{
  "version": "0.1.2"
}
```

既に `0.1.2` 以上になっている場合は、現在のバージョンから patch version を 1 つ上げること。

---

## コミットメッセージ例

```text
Add comment request debug panel for production troubleshooting
```

または日本語の場合:

```text
コメント取得とリクエスト登録の切り分け用デバッグ表示を追加
```
