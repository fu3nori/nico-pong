# nico pong v0.1 追加実装指示書：実動画情報取得・手動/自動再生・強制再生

## 0. このMDの目的

この文書は、既に起動できる状態になった Chrome 拡張 **nico pong v0.1** に対して、次の不足機能を追加実装させるためのAI向け指示書である。

現在の問題：

- リクエストタブに登録されている動画が自動再生されない
- 手動再生 / 自動再生を切り替えるUIがない
- 動画情報ブロックをクリックしても、その動画を強制再生できない
- 動画情報がモックのままで、実際のニコニコ動画情報を取得していない
- ストックタブの動画ブロックをクリックしても強制再生されない

この追加指示で実装する範囲：

- 実動画情報取得
- リクエストタブの自動再生モード
- 手動再生 / 自動再生の切り替え
- リクエストタブ動画ブロックのクリック強制再生
- ストックタブ動画ブロックのクリック強制再生
- 再生状態管理
- 再生終了検出、またはタイマーによるフォールバック
- 未実装/失敗時にユーザーへ明確に表示するエラーUI

重要：

- この実装は、ニコ生ページ上の既存ログインセッションを利用する。
- ID/パスワード入力欄は作らない。
- Cookieを直接読む実装は禁止。
- `cookies` permission は追加しない。
- ニコニコの内部仕様・DOM構造に依存する箇所は、必ず `PlayerController` に隔離する。
- 動画情報取得APIも `nicoVideoApi.ts` に隔離する。
- 動画紹介機能のDOM操作が失敗した場合は、黙って失敗せず、Side Panel上にエラーを出す。

---

## 1. 今回の実装ゴール

### 1.1 実動画情報取得

動画IDまたはURLを入力したら、モックではなく実際のニコニコ動画情報を取得する。

表示する情報：

- サムネイル
- タイトル
- 投稿者名 / チャンネル名
- 作者名推定表示
- 再生数
- コメント数
- マイリスト数
- いいね数
- 再生時間
- タグ
- 生放送再生可否の警告

ただし、いいね数は取得できない場合がある。  
取得できない場合は `-` と表示し、追加自体は成功させる。

### 1.2 再生モード切り替え

リクエストタブに以下のトグルを追加する。

```text
再生モード: [手動] [自動]
```

またはスイッチ形式：

```text
[ ] リクエストを自動再生する
```

仕様：

- 手動モード：動画ブロックをクリックするか、再生ボタンを押した時だけ再生する
- 自動モード：リクエストタブの上から順に再生する
- ストックタブは常に手動再生扱い
- ストックタブの動画は自動再生キューには含めない

### 1.3 動画ブロックのクリック強制再生

リクエストタブ・ストックタブのどちらでも、動画ブロックをクリックしたらその動画を強制再生する。

仕様：

- 他の動画が再生中でも、クリックされた動画を優先する
- 現在再生中の動画は `interrupted` として履歴または状態に残す
- クリックによる再生は、手動モード/自動モードに関係なく実行する
- ストックタブから再生しても、リクエストキューの順番は変えない
- リクエストタブから再生した場合、その動画を `playing` にする
- 再生が始まったらSide Panel上部の「現在再生中」を更新する

---

## 2. 追加・変更するファイル

既存構成に対して以下を追加/変更する。

```text
src/
├─ sidepanel/
│  ├─ App.tsx
│  ├─ components/
│  │  ├─ PlaybackModeToggle.tsx        // 追加
│  │  ├─ NowPlayingPanel.tsx           // 追加
│  │  ├─ VideoCard.tsx                 // 変更
│  │  ├─ VideoList.tsx                 // 変更
│  │  └─ VideoInputForm.tsx            // 必要なら変更
│  └─ hooks/
│     ├─ usePlaybackController.ts      // 追加
│     ├─ usePlaybackMode.ts            // 追加
│     └─ useVideoLists.ts              // 変更
├─ content/
│  ├─ nicoliveContentScript.ts         // 変更
│  └─ playerController.ts              // 追加
├─ shared/
│  ├─ types.ts                         // 変更
│  ├─ messaging.ts                     // 変更
│  ├─ nicoVideoApi.ts                  // 追加またはモック置換
│  ├─ nicoThumbInfo.ts                 // 追加
│  ├─ playback.ts                      // 追加
│  └─ format.ts                        // 必要なら変更
└─ storage/
   ├─ videoRepository.ts               // 変更
   └─ settingsRepository.ts            // 変更
```

---

## 3. 追加する型定義

`src/shared/types.ts` に以下を追加・更新する。

```ts
export type PlaybackMode = "manual" | "auto";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "ended"
  | "interrupted"
  | "error";

export type VideoItemStatus =
  | "queued"
  | "playing"
  | "played"
  | "interrupted"
  | "skipped"
  | "error";

export type PlaybackSource = "request" | "stock" | "manual_input";

export type PlaybackState = {
  status: PlaybackStatus;
  currentVideoInternalId?: string;
  currentVideoId?: string;
  currentTitle?: string;
  source?: PlaybackSource;
  startedAt?: string;
  endedAt?: string;
  errorMessage?: string;
};

export type PlayVideoRequest = {
  video: NicoPongVideo;
  source: PlaybackSource;
  force: boolean;
};

export type PlayVideoResult =
  | {
      ok: true;
      videoId: string;
      startedAt: string;
      method: "nicolive_dom" | "fallback_open_watch_page" | "mock_disabled";
    }
  | {
      ok: false;
      videoId: string;
      errorMessage: string;
      debug?: unknown;
    };
```

既存の `NicoPongVideo` に以下を追加する。

```ts
export type NicoPongVideo = {
  // 既存フィールド...

  status?: VideoItemStatus;

  // getthumbinfo の no_live_play 相当。
  // 1 の場合、生放送プレイヤーで再生不可の可能性がある。
  noLivePlay?: boolean;

  // embeddable が false の場合、外部/埋め込み再生不可の可能性がある。
  embeddable?: boolean;

  // いいね数は取れないことがある
  likeCount?: number;

  // 取得元
  fetchSource?: "getthumbinfo" | "watch_page" | "watch_v3" | "mock";

  // 最終再生情報
  lastPlayedAt?: string;
  playCount?: number;
};
```

---

## 4. 実動画情報取得の実装指示

### 4.1 モック実装を置き換える

現在の `fetchNicoVideoInfo(videoId)` がモックを返している場合、実取得処理に置き換える。

ただし、ニコニコ側のAPIは公式に安定保証されたものではないため、処理は必ず `src/shared/nicoVideoApi.ts` に隔離する。

```ts
export async function fetchNicoVideoInfo(videoId: string): Promise<VideoFetchResult> {
  // 1. getthumbinfo を試す
  // 2. 足りない情報があれば watch page 解析を試す
  // 3. それでも足りない項目は undefined のまま返す
  // 4. 完全失敗時のみ ok:false
}
```

### 4.2 第一候補：getthumbinfo

まずは以下を呼ぶ。

```text
https://ext.nicovideo.jp/api/getthumbinfo/{videoId}
```

取得形式はXML。

取得対象：

| XML要素 | nico pong側 |
|---|---|
| `video_id` | `videoId` |
| `title` | `title` |
| `thumbnail_url` | `thumbnailUrl` |
| `length` | `durationSec` に変換 |
| `view_counter` | `viewCount` |
| `comment_num` | `commentCount` |
| `mylist_counter` | `mylistCount` |
| `watch_url` | `url` |
| `no_live_play` | `noLivePlay` |
| `embeddable` | `embeddable` |
| `user_id` | `ownerId` |
| `user_nickname` | `ownerName` |
| `ch_id` | `ownerId` |
| `ch_name` | `ownerName` |
| `tags/tag` | `tags`, `lockedTags` |

注意：

- `getthumbinfo` だけでは `likeCount` が取れない可能性が高い
- `likeCount` が取れない場合は `undefined` でよい
- UIでは `いいね: -` と表示する
- `status="fail"` の場合は保存しない
- `DELETED`, `COMMUNITY`, `NOT_FOUND` などのエラーコードを画面に出す

### 4.3 XMLパース実装例

`src/shared/nicoThumbInfo.ts` を作る。

```ts
export function parseNicoLengthToSeconds(length: string | undefined): number | undefined {
  if (!length) return undefined;

  const parts = length.split(":").map((v) => Number(v));
  if (parts.some((v) => Number.isNaN(v))) return undefined;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }

  return undefined;
}

export function textOf(root: ParentNode, selector: string): string | undefined {
  return root.querySelector(selector)?.textContent?.trim() || undefined;
}

export function intOf(root: ParentNode, selector: string): number | undefined {
  const text = textOf(root, selector);
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function bool01Of(root: ParentNode, selector: string): boolean | undefined {
  const text = textOf(root, selector);
  if (text === "1") return true;
  if (text === "0") return false;
  return undefined;
}
```

`DOMParser` でXMLを読む。

```ts
const xmlText = await response.text();
const doc = new DOMParser().parseFromString(xmlText, "application/xml");

const status = doc.documentElement.getAttribute("status");
if (status !== "ok") {
  const code = textOf(doc, "error > code");
  const description = textOf(doc, "error > description");
  return {
    ok: false,
    videoId,
    errorMessage: `動画情報を取得できません: ${code ?? "UNKNOWN"} ${description ?? ""}`.trim(),
  };
}
```

タグ取得：

```ts
const tagNodes = Array.from(doc.querySelectorAll("tags tag"));

const tags = tagNodes.map((node) => node.textContent?.trim()).filter(Boolean) as string[];

const lockedTags = tagNodes
  .filter((node) => node.getAttribute("lock") === "1")
  .map((node) => node.textContent?.trim())
  .filter(Boolean) as string[];
```

### 4.4 第二候補：watchページ解析

`getthumbinfo` で十分な情報が取れない場合、またはいいね数が必要な場合は、以下を試す。

```text
https://www.nicovideo.jp/watch/{videoId}
```

取得したHTMLから以下を探す。

- `#js-initial-watch-data`
- `data-api-data`
- `data-environment`
- JSON-LD
- `server-response` 系の埋め込みJSON

注意：

- ニコニコ側のHTML構造は変更される可能性がある
- 解析できなければ諦めてよい
- いいね数が取れなくてもエラー扱いにしない
- この処理も `nicoVideoApi.ts` 内に隔離する

方針：

```ts
async function fetchWatchPageExtra(videoId: string): Promise<Partial<NicoPongVideo>> {
  // 取れたら likeCount や追加メタ情報を返す
  // 取れなければ {}
}
```

### 4.5 watch/v3系APIについて

`www.nicovideo.jp/api/watch/v3/{videoId}` や `watch/v3_guest` 系は内部APIであり、変更リスクが高い。  
使う場合は必ず次の条件を守る。

- `nicoVideoApi.ts` に隔離する
- 失敗してもアプリ全体を落とさない
- READMEに「ニコニコ側の仕様変更で取得できなくなる可能性あり」と書く
- Cookieを直接読まない
- ログインが必要なAPIにID/パスワードを入力させない

v0.1追加実装では、まず `getthumbinfo` + watchページ解析でよい。

---

## 5. 再生制御の全体設計

再生制御は3層に分ける。

```text
Side Panel UI
  ↓
PlaybackController hook
  ↓
Chrome messaging
  ↓
Content Script PlayerController
  ↓
ニコ生ページDOM操作
```

### 5.1 なぜ分けるか

- Side Panelはニコ生ページのDOMを直接操作できない
- Content Scriptはニコ生ページのDOMを読める/操作できる
- ただしContent ScriptはページJSの変数には直接アクセスできない
- そのため、DOM操作・クリック・inputイベント発火はContent Script側に集約する

---

## 6. メッセージング追加

`src/shared/messaging.ts` に以下を追加する。

```ts
export type NicoPongMessage =
  // 既存
  | { type: "GET_PROGRAM_INFO" }
  | { type: "PROGRAM_INFO_RESULT"; payload: ProgramInfo }
  | { type: "FETCH_VIDEO_INFO"; payload: { videoId: string } }
  | { type: "FETCH_VIDEO_INFO_RESULT"; payload: VideoFetchResult }

  // 追加
  | { type: "PLAY_VIDEO"; payload: PlayVideoRequest }
  | { type: "PLAY_VIDEO_RESULT"; payload: PlayVideoResult }
  | { type: "STOP_VIDEO" }
  | { type: "PLAYBACK_STATE_CHANGED"; payload: PlaybackState }
  | { type: "GET_PLAYBACK_STATE" };
```

Side Panelから現在のニコ生タブへ `PLAY_VIDEO` を送る。

---

## 7. PlayerController実装

`src/content/playerController.ts` を追加する。

```ts
import type { NicoPongVideo, PlayVideoResult } from "../shared/types";

export interface PlayerController {
  play(video: NicoPongVideo, options: { force: boolean }): Promise<PlayVideoResult>;
  stop(): Promise<void>;
  getState(): Promise<unknown>;
}
```

### 7.1 DOM操作方式

v0.1追加実装では、ニコ生ページの「動画紹介」UIをDOM操作する。

実装AIは、現在のニコ生ページDOMを確認し、以下の流れで実装する。

1. 動画紹介機能を開くボタンを探す
2. 動画ID/URL入力欄を探す
3. 入力欄に `https://www.nicovideo.jp/watch/{videoId}` または `{videoId}` をセットする
4. `input` / `change` イベントを発火する
5. 再生/紹介/決定ボタンをクリックする
6. 成功/失敗を返す

重要：

- セレクタをベタ書きしすぎない
- 候補セレクタ配列を作る
- セレクタが見つからない場合はエラーにする
- エラー時はSide Panelに「ニコ生の動画紹介UIを見つけられません」と表示する
- 失敗を握りつぶさない

### 7.2 候補セレクタ方式

例：

```ts
const VIDEO_INTRO_SELECTOR_CANDIDATES = {
  openPanelButtons: [
    '[aria-label*="動画"]',
    'button[title*="動画"]',
  ],
  inputs: [
    'input[placeholder*="動画"]',
    'input[placeholder*="URL"]',
    'input[type="text"]',
  ],
  playButtonTexts: [
    "再生",
    "紹介",
    "開始",
    "決定",
    "引用",
  ],
};
```

標準DOMの `querySelector` は `:has-text()` を使えない。  
実装では以下のようなヘルパーを作る。

```ts
function findButtonByText(textCandidates: string[]): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find((button) => {
    const text = button.textContent?.trim() ?? "";
    const aria = button.getAttribute("aria-label") ?? "";
    const title = button.getAttribute("title") ?? "";
    return textCandidates.some((candidate) =>
      text.includes(candidate) || aria.includes(candidate) || title.includes(candidate)
    );
  }) as HTMLButtonElement | null;
}
```

### 7.3 React制御inputへの値セット

ニコ生ページ側がReact等で制御inputを使っている場合、単に `input.value = videoId` では反映されないことがある。  
以下のような実装を使う。

```ts
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototype = Object.getPrototypeOf(input);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else if (valueSetter) {
    valueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
```

### 7.4 DOMが不明な場合のデバッグ出力

`PlayerController.play()` が失敗した場合、以下を `debug` に含める。

- 現在URL
- 見つかったbuttonテキスト一覧
- 見つかったinput placeholder一覧
- 使用したvideoId
- どの段階で失敗したか

ただし、個人情報やCookieは含めない。

---

## 8. 強制再生仕様

### 8.1 UI操作

`VideoCard` をクリックしたら強制再生する。

ただし、以下のボタン操作時はカードクリック扱いにしない。

- 削除ボタン
- 作者名編集
- メモ編集
- D&Dハンドル
- リクエストへ送る/ストックへ送る

実装例：

```tsx
<article
  className="video-card"
  role="button"
  tabIndex={0}
  onClick={handleForcePlay}
  onKeyDown={(event) => {
    if (event.key === "Enter") handleForcePlay();
  }}
>
```

ボタン類は `event.stopPropagation()` する。

### 8.2 明示的な再生ボタンも付ける

カードクリックだけだと誤爆しやすいので、カード内に必ずボタンも置く。

```text
[今すぐ再生]
```

クリック仕様：

```ts
await forcePlayVideo(video, source);
```

### 8.3 強制再生時の状態遷移

現在再生中がある場合：

```text
playing → interrupted
```

新しい動画：

```text
queued/none → playing
```

ストック動画の場合：

- `PlaybackState` は更新する
- ストック側の順番は変えない
- `lastPlayedAt` と `playCount` は更新する

リクエスト動画の場合：

- その動画を `playing` にする
- 以前の再生中動画がリクエストなら `interrupted` にする
- 再生終了後は `played` にする

---

## 9. 自動再生仕様

### 9.1 対象

自動再生対象は **リクエストタブのみ**。

ストックタブの動画は自動再生対象にしない。

### 9.2 自動再生ON/OFF

設定として保存する。

```ts
type Settings = {
  playbackMode: PlaybackMode; // "manual" | "auto"
  autoPlayDelaySec: number;   // 初期値 2
  skipNoLivePlayByDefault: boolean; // 初期値 true
};
```

UI：

```text
再生モード: 手動 / 自動
自動再生ディレイ: 2秒
[ ] 生放送再生不可の可能性がある動画は自動再生しない
```

v0.1追加実装では、詳細設定UIが重ければ以下だけでよい。

```text
[ ] リクエストを自動再生する
```

### 9.3 自動再生開始条件

自動再生ONで、以下を満たす場合に次の動画を再生する。

- 現在再生中がない
- リクエストタブに `queued` の動画がある
- `noLivePlay !== true`、または設定で許可されている
- 動画情報取得済み
- エラー状態ではない

### 9.4 再生終了検出

理想：

- ニコ生ページDOMまたは動画紹介プレイヤーから再生終了イベントを検出する

ただしDOMが不明・イベントが取れない可能性があるため、v0.1追加実装ではフォールバックを必ず用意する。

フォールバック：

- 再生開始時に `durationSec` を見てタイマーをセット
- `durationSec + 2秒` 経過で終了扱いにする
- `durationSec` が不明の場合は自動終了しない
- 手動で「次へ」または「停止」できるようにする

### 9.5 タイマー管理

`usePlaybackController.ts` でタイマーを管理する。

ルール：

- 強制再生が入ったら既存タイマーをキャンセルする
- 停止したらタイマーをキャンセルする
- 自動再生OFFに切り替えたらタイマーをキャンセルする
- Side Panelが再読み込みされた場合、現在状態を復元できないなら `idle` に戻す

---

## 10. NowPlayingPanel

Side Panel上部に現在再生中表示を追加する。

```text
現在再生中
[サムネ]
タイトル
作者: hogeP
ソース: リクエスト / ストック
状態: 再生中
[停止] [次へ] [再生済みにする]
```

### 10.1 ボタン

| ボタン | 内容 |
|---|---|
| 停止 | content scriptへ `STOP_VIDEO` を送る |
| 次へ | 現在を `skipped` にして次のリクエストを再生 |
| 再生済みにする | 手動で `played` にする |

v0.1追加実装では、停止DOM操作が難しい場合は状態だけ止めてもよい。  
ただしUIには「ニコ生側の停止操作は未実装」と表示する。

---

## 11. RequestTabの再生順

リクエストタブでは、上から順に再生する。

次に再生する動画取得関数：

```ts
export function findNextPlayableRequest(videos: NicoPongVideo[]): NicoPongVideo | null {
  return [...videos]
    .sort((a, b) => a.order - b.order)
    .find((video) => {
      if (video.status === "played") return false;
      if (video.status === "skipped") return false;
      if (video.status === "error") return false;
      if (video.noLivePlay) return false;
      return true;
    }) ?? null;
}
```

注意：

- `interrupted` は再生候補に戻すかどうか設定にする
- v0.1追加では、`interrupted` は自動再生対象から外す
- 手動クリックなら `interrupted` でも再生できる

---

## 12. 保存更新

`videoRepository.ts` に以下を追加する。

```ts
export async function updateVideoStatus(
  id: string,
  status: VideoItemStatus
): Promise<void>;

export async function markVideoPlayed(
  id: string,
  playedAt: string
): Promise<void>;

export async function incrementPlayCount(
  id: string
): Promise<void>;
```

`settingsRepository.ts` に以下を追加する。

```ts
export async function getPlaybackMode(): Promise<PlaybackMode>;

export async function setPlaybackMode(mode: PlaybackMode): Promise<void>;
```

---

## 13. UIの具体的変更

### 13.1 ヘッダー下

```text
nico pong
番組: {番組タイトル}
lvID: {lvID}

現在再生中:
{なければ「なし」}

再生モード:
(●) 手動  ( ) 自動
```

### 13.2 リクエストタブ

各カード：

```text
[サムネ]
タイトル
作者: ...
再生: ... / コメ: ... / マイリス: ... / いいね: ...
状態: queued
[今すぐ再生] [削除]
```

カード全体クリックでも強制再生。

### 13.3 ストックタブ

各カード：

```text
[サムネ]
タイトル
作者: ...
再生: ... / コメ: ... / マイリス: ... / いいね: ...
[今すぐ再生] [リクエストへ送る] [削除]
```

カード全体クリックでも強制再生。

---

## 14. エラー表示

以下を必ず出す。

### 14.1 動画情報取得失敗

```text
動画情報を取得できませんでした。
動画ID: smxxxx
理由: NOT_FOUND / DELETED / COMMUNITY / ネットワークエラー
```

### 14.2 動画紹介UIが見つからない

```text
ニコ生ページの動画紹介UIを見つけられませんでした。
ニコ生のページを開き、生主としてログインしているか確認してください。
```

### 14.3 再生不可警告

`noLivePlay === true` の場合：

```text
この動画は生放送プレイヤーで再生できない可能性があります。
自動再生からは除外しました。
```

ただし手動再生ボタンは残してよい。

### 14.4 いいね数未取得

```text
いいね: -
```

これはエラー扱いにしない。

---

## 15. 受け入れ基準

この追加実装は、以下を満たしたら完了。

### 15.1 動画情報

- モックではなく、実際の動画タイトルが出る
- サムネイルが出る
- 再生数・コメント数・マイリスト数が出る
- 投稿者名またはチャンネル名が出る
- いいね数が取れない場合でも落ちない
- 削除/非公開/存在しない動画でエラー表示される

### 15.2 手動再生

- リクエストタブの動画カードをクリックすると再生処理が走る
- ストックタブの動画カードをクリックすると再生処理が走る
- `今すぐ再生` ボタンでも再生処理が走る
- 他動画再生中にクリックすると、クリックした動画が優先される
- Side Panelの現在再生中が更新される

### 15.3 自動再生

- リクエストタブに複数動画がある
- 自動再生ONにする
- 上から順に再生処理が走る
- 1本目終了後、次の動画へ進む
- 手動再生が入った場合、自動再生タイマーが破棄される
- 自動再生OFFでは勝手に再生されない

### 15.4 状態管理

- 再生中動画は `playing`
- 終了した動画は `played`
- 割り込みされた動画は `interrupted`
- 失敗した動画は `error`
- リロード後も最低限、動画リストと再生モードが保持される

### 15.5 セキュリティ

- Cookieを直接読んでいない
- ID/パスワードを扱っていない
- `cookies` permissionを追加していない
- 外部サーバーへユーザーデータを送信していない

---

## 16. AIへの追加プロンプト例

以下をAIコーディングエージェントに渡す。

```text
現在の nico pong v0.1 は起動できていますが、以下が未実装です。

- 動画情報取得がモックのまま
- リクエストタブの自動再生がない
- 手動再生/自動再生の切り替えがない
- 動画カードクリックで強制再生できない
- ストックタブの動画カードクリックで強制再生できない

docs/nico-pong-v0.1-playback-and-real-video-info-addendum.md の仕様に従って、追加実装してください。

優先順位：
1. モック動画情報取得を廃止し、getthumbinfoベースの実動画情報取得を実装
2. リクエスト/ストック両方の動画カードクリックで forcePlayVideo(video) を呼ぶ
3. Side PanelからContent Scriptへ PLAY_VIDEO メッセージを送る
4. Content Script側に PlayerController を作り、ニコ生ページの動画紹介UIをDOM操作して再生する
5. 再生モード手動/自動トグルを追加
6. リクエストタブの自動再生キューを実装
7. NowPlayingPanel と状態管理を追加

注意：
- CookieやID/パスワードは扱わない
- cookies permissionは追加しない
- ニコ生のDOMセレクタが不明な箇所は PlayerController に隔離し、失敗時は画面に明確なエラーを出す
- 動画紹介UIのDOM操作がうまくいかない場合でも、動画情報取得とUI/状態管理までは完成させる
- 実装後に npm run build を通す
- 変更ファイル、動作確認手順、未解決TODOを報告する
```

---

## 17. 実装時の注意点

### 17.1 「強制再生」の表記

UI上は「強制再生」よりも、ユーザー向けには以下がよい。

```text
今すぐ再生
```

内部関数名は `forcePlayVideo` でよい。

### 17.2 カードクリック誤爆対策

カード全体クリックは便利だが、削除や編集と衝突する。  
必ず各操作ボタンでは `event.stopPropagation()` する。

### 17.3 自動再生は危険なので初期値OFF

初期値は必ず手動モード。

```ts
playbackMode: "manual"
```

### 17.4 生放送再生不可動画

`noLivePlay === true` の動画は、自動再生から除外する。  
手動再生は可能にしてよいが、クリック時に確認を出す。

### 17.5 実API失敗時

動画情報取得が失敗した時にモックへフォールバックしない。  
モックを残すと、ユーザーが本当に取得できていると誤認するため。

開発用モックが必要なら、環境変数で明示的に切り替える。

```ts
const USE_MOCK_VIDEO_API = import.meta.env.VITE_USE_MOCK_VIDEO_API === "true";
```

本番ビルドでは `false`。

---

## 18. 将来に残すTODO

今回無理にやらないもの。

- ニコ生コメントからの動画ID自動受付
- 生主コメント投稿
- 公式NGワード/NGユーザー同期
- 完全な再生終了イベント取得
- セットリスト出力
- Chrome Web Store公開用プライバシーポリシー整備
- 動画紹介UIのセレクタ自動更新機構

ただし、今回の実装で `PlayerController` と `PlaybackController` を分離しておけば、これらは後から追加できる。

---

## 19. 参考情報メモ

実装時は最新情報を確認すること。

- Chrome Side Panel API
- Chrome Content Scripts
- Chrome Extension Message Passing
- ニコニコ動画 getthumbinfo
- ニコニコ動画 watchページの埋め込み初期データ
- ニコニコ内部APIは予告なく変わる可能性があるため、取得処理は必ず隔離する
