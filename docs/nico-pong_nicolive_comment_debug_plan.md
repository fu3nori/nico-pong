# nico-pong コメント取得切り分け＋ニコヘル方式寄せ 実装指示書

## 目的

nico-pong のリクエストタブに、視聴者コメントで投稿された動画IDが入らない問題を切り分ける。

現状、エージェント側では以下が推定されている。

> `#embedded-data` の `site.relive.webSocketUrl` パスが現行ニコ生では別場所に移動しており、content script が空 string を返している。  
> その結果 `"webSocketUrl が空です"` エラーになっている。

ただし、ニコヘル（nicolivehelperxx）では現行ニコ生からコメント取得できているため、単純に「コメント取得不能」と判断せず、ニコヘルの実装・現行仕様に沿ってコメント取得フローを再設計する。

## 参照資料

- nicolivehelperxx  
  https://github.com/amanorox/nicolivehelperxx

- ニコニコ生放送のコメント取得方式に関する資料  
  https://qiita.com/DaisukeDaisuke/items/3938f245caec1e99d51e

## 基本方針

現在の nico-pong は `#embedded-data` の `site.relive.webSocketUrl` 取得に依存している可能性がある。

しかし、現行ニコ生のコメント取得は、単に `webSocketUrl` を取って終わりではない。  
watch WebSocket に接続した後、`startWatching` を送り、`messageServer` イベントから実際のコメント取得先である `viewUri` を受け取り、その後 message server / segment server 側の stream からコメントを取得する流れになる。

したがって、修正は以下のどちらかだけで済ませないこと。

- `site.relive.webSocketUrl` のパスだけを直す
- `"webSocketUrl が空です"` のエラーだけを握りつぶす

ニコヘルのコメント取得方式に寄せて、段階的に状態を可視化しながら実装する。

## 想定される現行コメント取得フロー

おおまかな流れは以下。

1. ニコ生番組ページを開く
2. `#embedded-data` / `data-props` 等から初期情報を取得する
3. watch 用 WebSocket URL を取得する
4. watch WebSocket に接続する
5. `startWatching` を送信する
6. `seat` を受信する
7. `keepSeat` を送信して座席を維持する
8. `ping` を受信したら `pong` を返す
9. watch WebSocket から `messageServer` イベントを受信する
10. `messageServer.data.viewUri` を取得する
11. `viewUri` へ HTTP streaming / message stream 接続する
12. message server / segment server からコメントデータを受信する
13. 必要に応じて protobuf / chunk を decode する
14. コメント本文を取り出す
15. コメント本文から動画IDを抽出する
16. 動画情報を取得する
17. リクエストタブに登録する

## 今回の疑い箇所

今回のバグは、以下のどこかで止まっている可能性が高い。

```txt
A. #embedded-data の探索パスが現行DOMに合っていない
B. watch WebSocket URL が取得できていない
C. watch WebSocket には繋いでいるが startWatching が不足または不正
D. ping / pong または keepSeat 未対応で接続維持できていない
E. messageServer イベントを監視していない
F. messageServer.data.viewUri に接続していない
G. message server / segment server の stream を読めていない
H. protobuf / chunk decode に失敗している
I. コメント本文は取れているが動画ID抽出で失敗している
J. 動画ID抽出後、動画情報取得またはリクエスト登録で失敗している
```

特に、`site.relive.webSocketUrl` の取得失敗だけで終了している場合、  
D〜H の現行コメント取得フローに到達できていない可能性が高い。

## 実装方針

### 1. 本番画面にデバッグ状態表示を追加する

本番画面、または side panel に「コメント受信デバッグ」欄を追加する。

最低限、以下を表示する。

```txt
[コメント受信デバッグ]

番組ID:
embedded-data取得:
webSocketUrl候補:
watch WebSocket接続:
startWatching送信:
seat受信:
keepSeat送信:
ping受信:
pong送信:
messageServer受信:
viewUri取得:
message stream接続:
protobuf/chunk decode:
コメント受信件数:
最新コメント:
動画ID抽出:
動画情報取得:
リクエスト登録:
最終エラー:
```

表示は開発用でよいが、実際の本番ニコ生画面上で状態が確認できるようにする。

### 2. `webSocketUrl` 取得失敗時に即終了しない

現在のように、

```txt
webSocketUrl が空です
```

で終了すると、どこまで取得できているかが分からない。

実装では以下を行う。

- `#embedded-data` が存在するか表示する
- `data-props` が存在するか表示する
- JSON parse に成功したか表示する
- `site.relive.webSocketUrl` 以外にも候補パスを探索する
- 取得できた候補URLをデバッグ欄に表示する
- 取得できなかった場合は、取得できた初期データの主要キー一覧を表示する

例：

```js
const embedded = document.querySelector("#embedded-data");
const props = embedded?.getAttribute("data-props");

debugState.embeddedDataFound = !!embedded;
debugState.dataPropsFound = !!props;

let parsed = null;
try {
  parsed = props ? JSON.parse(props) : null;
  debugState.dataPropsParsed = !!parsed;
  debugState.rootKeys = parsed ? Object.keys(parsed) : [];
} catch (e) {
  debugState.dataPropsParsed = false;
  debugState.lastError = `data-props JSON parse failed: ${e.message}`;
}
```

### 3. WebSocket URL 候補を広く探索する

`site.relive.webSocketUrl` 固定ではなく、初期データ内から WebSocket URL らしき値を再帰的に探索する。

例：

```js
function findWebSocketUrls(value, path = "", results = []) {
  if (!value) return results;

  if (typeof value === "string") {
    if (value.startsWith("ws://") || value.startsWith("wss://")) {
      results.push({ path, value });
    }
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findWebSocketUrls(item, `${path}[${index}]`, results);
    });
    return results;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      findWebSocketUrls(child, childPath, results);
    }
  }

  return results;
}
```

取得結果をデバッグ欄に表示する。

```txt
webSocketUrl候補:
- site.relive.webSocketUrl: wss://...
- その他候補パス: wss://...
```

### 4. ニコヘル方式に寄せたコメント取得処理へ再設計する

処理を以下の段階に分ける。

#### content script

役割：

- ニコ生番組ページDOMから番組ID・初期データを取得する
- `#embedded-data` / `data-props` の有無を確認する
- 取得した初期情報・候補URLを background service worker に渡す
- 画面上にデバッグ状態を表示する
- background から受け取ったコメントイベントを side panel / request store へ渡す

#### background service worker

役割：

- watch WebSocket 接続
- `startWatching` 送信
- `seat` / `keepSeat` 対応
- `ping` / `pong` 対応
- `messageServer` イベントの監視
- `messageServer.data.viewUri` の取得
- message stream 接続
- protobuf / chunk decode
- コメントイベント生成
- content script / side panel へコメントを通知

#### side panel

役割：

- デバッグ状態表示
- 受信コメント一覧表示
- 動画ID抽出結果表示
- リクエストタブ登録結果表示

## デバッグイベント設計

background / content script / side panel 間で、以下のようなデバッグイベントを流す。

```ts
type NicoPongDebugEvent = {
  stage:
    | "embedded_data"
    | "websocket_url"
    | "watch_ws_connect"
    | "start_watching"
    | "seat"
    | "keep_seat"
    | "ping"
    | "pong"
    | "message_server"
    | "view_uri"
    | "message_stream"
    | "decode"
    | "comment"
    | "video_id_extract"
    | "video_info"
    | "request_add"
    | "error";
  ok: boolean;
  message: string;
  detail?: unknown;
  timestamp: number;
};
```

ログは console だけでなく、UIにも表示すること。

## コメント受信時の表示例

コメントを受信できた場合、以下のように表示する。

```txt
コメント受信件数: 12
最新コメント: sm12345678
動画ID抽出: sm12345678
動画情報取得: 成功 / タイトル: xxxx
リクエスト登録: 成功
```

コメントは受信できているが動画ID抽出に失敗している場合：

```txt
コメント受信件数: 12
最新コメント: これ再生して sm12345678
動画ID抽出: 失敗
最終エラー: video id regex did not match
```

この場合はコメント取得ではなく動画ID抽出ロジックの問題。

## 動画ID抽出対象

最低限、以下に対応する。

```txt
sm12345678
nm12345678
so12345678
lv123456789
https://www.nicovideo.jp/watch/sm12345678
https://nico.ms/sm12345678
```

例：

```js
function extractNicoVideoId(text) {
  if (!text) return null;

  const patterns = [
    /(sm\d+)/i,
    /(nm\d+)/i,
    /(so\d+)/i,
    /(lv\d+)/i,
    /nicovideo\.jp\/watch\/(sm\d+|nm\d+|so\d+|lv\d+)/i,
    /nico\.ms\/(sm\d+|nm\d+|so\d+|lv\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}
```

## 受け入れ条件

以下を満たすこと。

### 必須

- 本番ニコ生画面上で「コメント受信デバッグ」欄が見える
- `#embedded-data` / `data-props` の取得成否が見える
- WebSocket URL 候補の探索結果が見える
- watch WebSocket 接続成否が見える
- `startWatching` 送信成否が見える
- `seat` / `keepSeat` / `ping` / `pong` の状態が見える
- `messageServer` イベント受信成否が見える
- `messageServer.data.viewUri` の取得成否が見える
- message stream 接続成否が見える
- decode 成否が見える
- コメント受信件数と最新コメントが見える
- 動画ID抽出結果が見える
- リクエスト登録成否が見える
- 視聴者側から `sm12345678` のような動画IDをコメントした時、どの段階まで到達したか分かる

### 理想

- ニコヘルの実装・現行仕様に合わせて、watch WebSocket → messageServer → viewUri → stream decode の流れでコメントを取得できる
- content script に処理を詰め込まず、background service worker 側で通信・decode を担当する
- side panel でデバッグログを時系列表示できる
- 通常利用時はデバッグ表示をOFFにできる

## 注意点

- `site.relive.webSocketUrl` のパス修正だけで完了扱いにしないこと
- `"webSocketUrl が空です"` を握りつぶすだけで完了扱いにしないこと
- コメントが取れない場合も、どの段階で止まったかをUI上に出すこと
- console.log のみでは不可。必ず本番画面または side panel 上で確認できるようにすること
- ニコヘルでコメント取得できている以上、nico-pong 側もニコヘルの取得フローを参考にして実装すること

## 最終ゴール

視聴者がニコ生コメントで動画IDを投稿したとき、nico-pong が以下の流れで処理できるようにする。

```txt
視聴者コメント投稿
↓
nico-pong がコメント受信
↓
コメント本文を表示
↓
動画IDを抽出
↓
動画情報を取得
↓
リクエストタブへ登録
↓
自動再生または手動再生キューへ反映
```

この実装により、問題が以下のどれなのかを確実に切り分ける。

```txt
1. コメント取得前で止まっている
2. watch WebSocket 接続で止まっている
3. messageServer / viewUri 取得で止まっている
4. stream decode で止まっている
5. コメント本文取得後の動画ID抽出で失敗している
6. 動画ID抽出後の動画情報取得で失敗している
7. リクエストタブ登録で失敗している
```
