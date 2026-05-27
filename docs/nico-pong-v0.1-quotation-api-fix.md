# nico pong v0.1 追加修正指示書：ニコ生「引用再生API」直叩き対応

## 0. このMDの目的

この文書は、Chrome拡張 **nico pong** の現在実装で発生している問題を修正するためのAIコーディング向け追加指示書である。

現在の問題：

- 現在のニコニコ生放送UIには、旧来想定していた単純な「動画を紹介」ボタンが存在しない。
- 実際には、放送画面左下の `＋` ボタンから「放送ネタ」パネルを開き、タブを選び、動画を検索して、検索結果を選ぶ必要がある。
- このUIをDOM操作で自動運転するのは不安定すぎる。
- そのため、DOMクリック方式ではなく、ニコ生の引用再生APIを直接呼び出す方式へ修正する。
- New NicoLive Helper（nicolivehelperxx）のソースコードに、引用再生APIの呼び出しが既に実装されているため、それを参考にする。

このMDでは、**DOM操作による再生制御を廃止し、引用再生APIクライアントを実装する**。

---

## 1. 前提

### 1.1 対象アプリ

- Chrome拡張：`nico pong`
- UI：Chrome Side Panel
- 対象ページ：`https://live.nicovideo.jp/watch/lv...`

### 1.2 既にできていること

- Chrome拡張として起動できる
- Side Panelが表示できる
- リクエストタブ・ストックタブがある
- 動画情報ブロックが表示される
- 再生処理を呼ぶところまでは存在する

### 1.3 今回やること

今回の最重要修正はこれ。

```text
旧方針：
Side Panel
  ↓
Content Script
  ↓
ニコ生ページDOMを操作
  ↓
「動画を紹介」UIを探してクリック

新方針：
Side Panel
  ↓
Content Script / Service Worker
  ↓
ニコ生の引用再生APIをfetch
  ↓
動画を直接引用再生
```

---

## 2. nicolivehelperxxから判明した引用再生API

New NicoLive Helper の `main/main.js` には、以下のエンドポイント群が使われている。

ベースURL：

```text
https://services-eapi.spi.nicovideo.jp
```

引用再生状態取得：

```http
GET /v1/tools/live/contents/{lvId}/quotation
```

引用再生開始：

```http
POST /v1/tools/live/contents/{lvId}/quotation
```

引用中コンテンツ差し替え：

```http
PATCH /v1/tools/live/contents/{lvId}/quotation/contents
```

引用再生停止：

```http
DELETE /v1/tools/live/contents/{lvId}/quotation
```

つまり、API全体のURLは以下。

```text
https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation/contents
```

---

## 3. API直叩き方式に変更する理由

2026年6月現在のニコ生UIでは、動画引用までの導線が深い。

ユーザー確認済みのUI導線：

```text
1. 放送画面左下の「＋」ボタン
2. 放送ネタパネル
3. 「動画・生放送実況」タブ
4. 検索欄へ動画ID入力
5. 検索結果から対象動画を選択
6. 引用再生開始
```

このUIをChrome拡張からDOM操作する場合、次の問題がある。

- ボタン名・class名・DOM階層が変わると即壊れる
- 検索結果が出るまで待機が必要
- 検索結果の1件目が目的動画とは限らない
- パネル状態・タブ状態・スクロール状態に依存する
- ニコ生側がReact等でDOMを再描画するとイベントが失敗しやすい
- 画面サイズや広告表示の影響を受ける

そのため、nico pongではDOMクリック方式をやめ、引用再生APIを直接呼ぶ。

---

## 4. 既存の `PlayerController` を作り直す

### 4.1 廃止するもの

以下のようなDOM検索・DOMクリック実装は廃止する。

```ts
findButtonByText(["動画紹介", "引用", "紹介"]);
findInputByPlaceholder(["動画", "URL"]);
button.click();
setNativeInputValue(input, videoId);
```

### 4.2 新しく作るもの

`src/content/nicoLiveQuotationApi.ts` を追加する。

```ts
import type {
  NicoPongVideo,
  PlayVideoResult,
  QuotationStatusResult,
  StopVideoResult,
} from "../shared/types";

export class NicoLiveQuotationApi {
  constructor(private readonly lvId: string) {}

  async getQuotationStatus(): Promise<QuotationStatusResult> {
    // GET /quotation
  }

  async play(video: NicoPongVideo, options?: { force?: boolean }): Promise<PlayVideoResult> {
    // GET /quotation
    // 404ならPOST /quotation
    // 200等で既に引用再生中ならPATCH /quotation/contents
  }

  async stop(): Promise<StopVideoResult> {
    // DELETE /quotation
  }
}
```

既存の `playerController.ts` は、このAPIクラスを呼ぶだけにする。

---

## 5. Content ScriptでlvIDとembedded-dataを取得する

### 5.1 lvID

URLから取得する。

```ts
const lvId = location.pathname.match(/\/watch\/(lv\d+)/)?.[1];
```

### 5.2 embedded-data

New NicoLive Helperでは、ニコ生ページの以下の要素から `data-props` を読み取っている。

```ts
const embedded = document.querySelector("#embedded-data");
const dataProps = embedded?.getAttribute("data-props");
const liveData = dataProps ? JSON.parse(dataProps) : null;
```

nico pongでも、まずこの方法で番組情報を取得する。

取得できる場合、以下を保持する。

```ts
type NicoLiveEmbeddedData = {
  program?: {
    nicoliveProgramId?: string;
    title?: string;
  };
  user?: {
    isBroadcaster?: boolean;
    isOperator?: boolean;
  };
  site?: {
    relive?: {
      csrfToken?: string;
    };
  };
};
```

注意：

- `site.relive.csrfToken` はアンケートAPIでは使われているが、nicolivehelperxxの引用再生API呼び出しでは明示的に送られていない。
- ただし、将来API仕様が変わる可能性があるため、取得できるなら保持しておく。
- `csrfToken` はログ出力しない。
- `csrfToken` はローカル保存しない。
- `csrfToken` は必要時のみメモリ上で使う。

---

## 6. 追加・変更する型定義

`src/shared/types.ts` に以下を追加する。

```ts
export type QuotationApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type QuotationPlaybackMethod =
  | "quotation_api_post"
  | "quotation_api_patch"
  | "quotation_api_delete";

export type QuotationStatusResult =
  | {
      ok: true;
      exists: true;
      currentContentId?: string;
      raw?: unknown;
    }
  | {
      ok: true;
      exists: false;
      status: 404;
      rawText?: string;
    }
  | {
      ok: false;
      status?: number;
      errorMessage: string;
      rawText?: string;
    };

export type StopVideoResult =
  | {
      ok: true;
      stoppedAt: string;
      method: "quotation_api_delete";
    }
  | {
      ok: false;
      errorMessage: string;
      status?: number;
      rawText?: string;
    };

export type PlayVideoResult =
  | {
      ok: true;
      videoId: string;
      startedAt: string;
      method: "quotation_api_post" | "quotation_api_patch";
      responseStatus: number;
      rawText?: string;
    }
  | {
      ok: false;
      videoId: string;
      errorMessage: string;
      responseStatus?: number;
      errorCode?: string;
      rawText?: string;
    };
```

---

## 7. 引用再生APIの実装仕様

### 7.1 fetch先

```ts
const endpointBase = "https://services-eapi.spi.nicovideo.jp";

const quotationUrl =
  `${endpointBase}/v1/tools/live/contents/${lvId}/quotation`;

const quotationContentsUrl =
  `${endpointBase}/v1/tools/live/contents/${lvId}/quotation/contents`;
```

### 7.2 GET：現在引用再生中か確認

```http
GET https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
```

結果の扱い：

- `404` → 現在、引用再生中コンテンツなし
- `200` → 何か引用再生中
- その他 → エラー

実装例：

```ts
async function getQuotationStatus(lvId: string): Promise<QuotationStatusResult> {
  const url = `${endpointBase}/v1/tools/live/contents/${lvId}/quotation`;

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      "X-From-NicoPong-Extension": "1",
      "Accept": "application/json",
    },
  });

  const rawText = await response.text();

  if (response.status === 404) {
    return { ok: true, exists: false, status: 404, rawText };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorMessage: `引用再生状態の取得に失敗しました: HTTP ${response.status}`,
      rawText,
    };
  }

  let raw: unknown = undefined;
  try {
    raw = rawText ? JSON.parse(rawText) : undefined;
  } catch {
    raw = rawText;
  }

  const currentContentId = (raw as any)?.currentContent?.id;

  return {
    ok: true,
    exists: true,
    currentContentId,
    raw,
  };
}
```

### 7.3 POST：新規引用再生開始

現在引用再生中のコンテンツがない場合は `POST /quotation` を使う。

```http
POST https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
Content-Type: application/json
```

Body：

```json
{
  "contents": [
    {
      "id": "sm12345678",
      "type": "video"
    }
  ],
  "layout": {
    "main": {
      "source": "quote",
      "volume": 1
    },
    "sub": {
      "isSoundOnly": true,
      "source": "self",
      "volume": 1
    }
  },
  "repeat": false,
  "enableAddViewCount": true
}
```

音量はまず固定値でよい。

```ts
const DEFAULT_QUOTE_VOLUME = 1;
const DEFAULT_SELF_VOLUME = 1;
```

将来、設定画面で変更できるようにする。

### 7.4 PATCH：引用中コンテンツの差し替え

既に何かが引用再生中なら `PATCH /quotation/contents` を使う。

```http
PATCH https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation/contents
Content-Type: application/json
```

Body：

```json
{
  "contents": [
    {
      "id": "sm12345678",
      "type": "video"
    }
  ]
}
```

### 7.5 DELETE：引用再生停止

停止は以下。

```http
DELETE https://services-eapi.spi.nicovideo.jp/v1/tools/live/contents/{lvId}/quotation
```

Bodyは空でよい。  
ただし既存実装との互換のため `{}` を送ってもよい。

---

## 8. fetch実装上の重要点

### 8.1 credentials

必ず付ける。

```ts
credentials: "include"
```

理由：

- ニコ生にログイン済みのChromeセッションを使うため
- ID/パスワードやCookieを直接扱わないため
- `cookies` permission を使わずに、ブラウザの通常の認証状態を利用するため

### 8.2 Content Scriptから叩くか、Service Workerから叩くか

推奨は **Content Scriptから叩く**。

理由：

- Content Scriptは `live.nicovideo.jp` のページに注入されており、番組ページとの文脈が近い
- `#embedded-data` からlvIDや生主権限を取れる
- API失敗時のデバッグがしやすい
- Cookieを直接読む必要がない

ただし、CORSや拡張権限の問題でContent Script fetchが失敗する場合は、Service Worker経由に切り替える。

### 8.3 host_permissions

Manifest V3に以下を追加/維持する。

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

### 8.4 禁止事項

- `cookies` permission を追加しない
- ID/パスワード入力欄を作らない
- Cookie値を読み出さない
- csrfTokenをlocalStorageやIndexedDBに保存しない
- APIレスポンスに個人情報が含まれる可能性があるため、rawログを常時保存しない

---

## 9. `nicoLiveQuotationApi.ts` 実装例

以下のようなファイルを作る。

```ts
import type {
  NicoPongVideo,
  PlayVideoResult,
  QuotationStatusResult,
  StopVideoResult,
} from "../shared/types";

const ENDPOINT_BASE = "https://services-eapi.spi.nicovideo.jp";

function buildQuotationUrl(lvId: string): string {
  return `${ENDPOINT_BASE}/v1/tools/live/contents/${lvId}/quotation`;
}

function buildQuotationContentsUrl(lvId: string): string {
  return `${ENDPOINT_BASE}/v1/tools/live/contents/${lvId}/quotation/contents`;
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function extractApiError(text: string, fallback: string): {
  errorMessage: string;
  errorCode?: string;
} {
  const parsed = safeJsonParse(text) as any;

  const errorCode = parsed?.meta?.errorCode;
  const errorMessage = parsed?.meta?.errorMessage;

  return {
    errorCode,
    errorMessage: errorMessage || fallback,
  };
}

export class NicoLiveQuotationApi {
  constructor(private readonly lvId: string) {}

  async getQuotationStatus(): Promise<QuotationStatusResult> {
    const response = await fetch(buildQuotationUrl(this.lvId), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-From-NicoPong-Extension": "1",
      },
    });

    const rawText = await response.text();

    if (response.status === 404) {
      return {
        ok: true,
        exists: false,
        status: 404,
        rawText,
      };
    }

    if (!response.ok) {
      const err = extractApiError(
        rawText,
        `引用再生状態の取得に失敗しました: HTTP ${response.status}`
      );

      return {
        ok: false,
        status: response.status,
        errorMessage: err.errorMessage,
        rawText,
      };
    }

    const raw = safeJsonParse(rawText);
    const currentContentId = (raw as any)?.currentContent?.id;

    return {
      ok: true,
      exists: true,
      currentContentId,
      raw,
    };
  }

  async play(video: NicoPongVideo): Promise<PlayVideoResult> {
    const status = await this.getQuotationStatus();

    if (!status.ok) {
      return {
        ok: false,
        videoId: video.videoId,
        errorMessage: status.errorMessage,
        responseStatus: status.status,
        rawText: status.rawText,
      };
    }

    const hasCurrentQuotation = status.exists;

    const url = hasCurrentQuotation
      ? buildQuotationContentsUrl(this.lvId)
      : buildQuotationUrl(this.lvId);

    const method = hasCurrentQuotation ? "PATCH" : "POST";

    const body: any = {
      contents: [
        {
          id: video.videoId,
          type: "video",
        },
      ],
    };

    if (!hasCurrentQuotation) {
      body.layout = {
        main: {
          source: "quote",
          volume: 1,
        },
        sub: {
          isSoundOnly: true,
          source: "self",
          volume: 1,
        },
      };
      body.repeat = false;
      body.enableAddViewCount = true;
    }

    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-From-NicoPong-Extension": "1",
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();

    if (!response.ok) {
      const err = extractApiError(
        rawText,
        `${video.videoId} の引用再生に失敗しました: HTTP ${response.status}`
      );

      return {
        ok: false,
        videoId: video.videoId,
        errorMessage: err.errorMessage,
        errorCode: err.errorCode,
        responseStatus: response.status,
        rawText,
      };
    }

    return {
      ok: true,
      videoId: video.videoId,
      startedAt: new Date().toISOString(),
      method: hasCurrentQuotation
        ? "quotation_api_patch"
        : "quotation_api_post",
      responseStatus: response.status,
      rawText,
    };
  }

  async stop(): Promise<StopVideoResult> {
    const response = await fetch(buildQuotationUrl(this.lvId), {
      method: "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-From-NicoPong-Extension": "1",
      },
      body: "{}",
    });

    const rawText = await response.text();

    if (!response.ok) {
      const err = extractApiError(
        rawText,
        `引用再生停止に失敗しました: HTTP ${response.status}`
      );

      return {
        ok: false,
        errorMessage: err.errorMessage,
        status: response.status,
        rawText,
      };
    }

    return {
      ok: true,
      stoppedAt: new Date().toISOString(),
      method: "quotation_api_delete",
    };
  }
}
```

---

## 10. Content Script側のメッセージ処理

`src/content/nicoliveContentScript.ts` に、Side Panelからの再生命令を受ける処理を追加する。

```ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PLAY_VIDEO") {
    (async () => {
      const lvId = detectLvId();

      if (!lvId) {
        sendResponse({
          ok: false,
          videoId: message.payload.video.videoId,
          errorMessage: "lvIDを取得できません。ニコ生番組ページを開いてください。",
        });
        return;
      }

      const liveData = detectEmbeddedData();
      const isBroadcaster =
        liveData?.user?.isBroadcaster === true ||
        liveData?.user?.isOperator === true;

      if (!isBroadcaster) {
        sendResponse({
          ok: false,
          videoId: message.payload.video.videoId,
          errorMessage: "生主権限を確認できません。放送者アカウントで番組ページを開いてください。",
        });
        return;
      }

      const api = new NicoLiveQuotationApi(lvId);
      const result = await api.play(message.payload.video);
      sendResponse(result);
    })();

    return true;
  }

  if (message.type === "STOP_VIDEO") {
    (async () => {
      const lvId = detectLvId();

      if (!lvId) {
        sendResponse({
          ok: false,
          errorMessage: "lvIDを取得できません。",
        });
        return;
      }

      const api = new NicoLiveQuotationApi(lvId);
      const result = await api.stop();
      sendResponse(result);
    })();

    return true;
  }
});
```

注意：

- `sendResponse` を非同期で呼ぶため、`return true;` を忘れない。
- TypeScriptで型が合わない場合は、message型を既存の `NicoPongMessage` に統合する。

---

## 11. Side Panel側の再生処理

`usePlaybackController.ts` からContent Scriptへ `PLAY_VIDEO` を送る。

```ts
async function playVideo(video: NicoPongVideo, source: PlaybackSource) {
  const tab = await getActiveNicoliveTab();

  if (!tab?.id) {
    setError("ニコ生番組ページのタブが見つかりません。");
    return;
  }

  setPlaybackState({
    status: "loading",
    currentVideoInternalId: video.id,
    currentVideoId: video.videoId,
    currentTitle: video.title,
    source,
    startedAt: new Date().toISOString(),
  });

  const result = await chrome.tabs.sendMessage(tab.id, {
    type: "PLAY_VIDEO",
    payload: {
      video,
      source,
      force: true,
    },
  });

  if (!result?.ok) {
    setPlaybackState({
      status: "error",
      currentVideoInternalId: video.id,
      currentVideoId: video.videoId,
      currentTitle: video.title,
      source,
      errorMessage: result?.errorMessage || "引用再生に失敗しました。",
    });
    setError(result?.errorMessage || "引用再生に失敗しました。");
    await updateVideoStatus(video.id, "error");
    return;
  }

  setPlaybackState({
    status: "playing",
    currentVideoInternalId: video.id,
    currentVideoId: video.videoId,
    currentTitle: video.title,
    source,
    startedAt: result.startedAt,
  });

  await updateVideoStatus(video.id, "playing");
}
```

---

## 12. 自動再生の修正

自動再生は、API再生成功後に `durationSec` を使ってタイマーで次へ進める。

### 12.1 再生成功時

```ts
if (playbackMode === "auto" && source === "request") {
  const waitSec = (video.durationSec ?? 0) + autoPlayDelaySec;

  if (video.durationSec && video.durationSec > 0) {
    scheduleNext(waitSec);
  } else {
    showWarning("動画の再生時間が不明なため、自動次動画には進みません。");
  }
}
```

### 12.2 次動画選択

リクエストタブ上から順に、以下を満たす動画を選ぶ。

- `status !== "played"`
- `status !== "skipped"`
- `status !== "error"`
- `noLivePlay !== true`

### 12.3 手動再生が入った場合

- 既存の自動再生タイマーを必ずキャンセル
- クリックされた動画を即座にAPI再生
- その動画を現在再生中にする
- 以前の再生中動画は `interrupted` にする

---

## 13. エラー処理

引用再生APIで失敗した場合、レスポンスに以下のようなJSONが返る可能性がある。

```json
{
  "meta": {
    "status": 400,
    "errorCode": "BAD_REQUEST",
    "errorMessage": "引用再生できない動画です"
  }
}
```

画面には以下のように出す。

```text
sm12345678: 引用再生できない動画です
```

`errorMessage` が取れない場合：

```text
sm12345678 の引用再生に失敗しました: HTTP 400
```

### 13.1 引用不可動画の扱い

`errorMessage` に以下が含まれる場合：

```text
引用再生できない動画
コンテンツが存在しない
権限がない
```

動画ブロックに警告を付ける。

```ts
video.noLivePlay = true;
video.status = "error";
```

UI表示：

```text
引用不可
```

---

## 14. UI修正

### 14.1 エラーメッセージ変更

旧：

```text
動画紹介UIを見つけられませんでした
```

新：

```text
引用再生APIの呼び出しに失敗しました
```

詳細：

```text
- 生主としてログインしているか
- 番組ページを開いているか
- 番組がON AIR状態か
- 動画が引用再生可能か
- host_permissionsに services-eapi.spi.nicovideo.jp が入っているか
```

### 14.2 Debug表示

開発中は、設定でDebug表示をONにできるようにする。

表示内容：

- lvID
- API method
- API URL
- HTTP status
- `meta.errorCode`
- `meta.errorMessage`

表示しないもの：

- Cookie
- csrfToken
- ユーザー個人情報
- APIレスポンス全文の常時保存

---

## 15. manifest修正

`manifest.json` の `host_permissions` に必ず追加する。

```json
"https://services-eapi.spi.nicovideo.jp/*"
```

例：

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

`permissions` に `cookies` は追加しない。

---

## 16. 動作確認手順

### 16.1 前提

- Chromeでニコニコにログイン済み
- 対象アカウントが生主
- 自分の番組ページ `https://live.nicovideo.jp/watch/lv...` を開いている
- 番組がON AIR状態
- nico pong Side Panelを開いている

### 16.2 手動再生テスト

1. nico pongのストックタブに `sm9` 等の動画を登録する
2. 動画カードの「今すぐ再生」を押す
3. ニコ生プレイヤー側で引用再生が始まることを確認する
4. Side Panelの「現在再生中」が更新されることを確認する

### 16.3 差し替えテスト

1. 1本目を再生中に、別の動画カードをクリックする
2. `PATCH /quotation/contents` が呼ばれる
3. 再生中動画が差し替わる
4. 以前の動画が `interrupted` になる

### 16.4 停止テスト

1. NowPlayingPanelの「停止」を押す
2. `DELETE /quotation` が呼ばれる
3. 引用再生が停止する
4. Side Panel状態が `idle` になる

### 16.5 自動再生テスト

1. リクエストタブに複数動画を追加
2. 自動再生ON
3. 1本目を再生
4. `durationSec + delay` 後に次動画が再生される
5. 引用不可動画はスキップされる

### 16.6 引用不可テスト

1. 引用不可・削除済み・存在しない動画IDを登録する
2. 再生を試す
3. APIエラー文言がSide Panelに表示される
4. 動画ブロックに `引用不可` が付く

---

## 17. 受け入れ基準

今回の修正は以下を満たしたら完了。

- DOM上の「動画紹介」ボタン探索を行わない
- `services-eapi.spi.nicovideo.jp` の引用再生APIを使う
- 現在引用再生中か `GET /quotation` で判定する
- 未再生なら `POST /quotation` で開始する
- 既に再生中なら `PATCH /quotation/contents` で差し替える
- 停止は `DELETE /quotation` を使う
- リクエストタブの動画カードクリックでAPI再生できる
- ストックタブの動画カードクリックでAPI再生できる
- 手動/自動再生切替が機能する
- 自動再生ONではリクエストタブを上から順に再生する
- API失敗時に `meta.errorMessage` を画面表示する
- `cookies` permissionを追加していない
- ID/パスワードを扱っていない
- Cookie値を読んでいない
- `npm run build` が通る

---

## 18. AIへの追加プロンプト例

以下をそのままAIコーディングエージェントへ渡す。

```text
現在の nico pong は、ニコ生ページ上の「動画紹介」ボタンをDOM検索してクリックしようとして失敗しています。
2026年6月現在のニコ生UIでは、このDOM自動操作は不安定なので廃止します。

docs/nico-pong-v0.1-quotation-api-fix.md の仕様に従い、New NicoLive Helperの実装を参考にして、引用再生API直叩き方式へ修正してください。

最優先タスク：
1. DOMクリック方式のPlayerControllerを廃止または無効化
2. src/content/nicoLiveQuotationApi.ts を追加
3. GET /v1/tools/live/contents/{lvId}/quotation で現在状態を確認
4. 404なら POST /v1/tools/live/contents/{lvId}/quotation
5. 既に引用再生中なら PATCH /v1/tools/live/contents/{lvId}/quotation/contents
6. 停止は DELETE /v1/tools/live/contents/{lvId}/quotation
7. fetchには credentials: "include" を付ける
8. manifest.json の host_permissions に https://services-eapi.spi.nicovideo.jp/* を追加
9. リクエストタブ・ストックタブ双方の「今すぐ再生」からAPI再生を呼ぶ
10. API失敗時は meta.errorMessage をSide Panelに表示

制約：
- cookies permissionは追加しない
- ID/パスワードは扱わない
- Cookie値を読まない
- csrfTokenを保存しない
- DebugログにCookieやtokenを出さない
- npm run buildを通す

実装後、以下を報告してください。
- 変更ファイル
- 追加したAPIクライアント
- 手動再生テスト結果
- 自動再生テスト結果
- 失敗時のエラー表示
- 未解決TODO
```

---

## 19. 注意点

### 19.1 APIは非公開・内部仕様

この引用再生APIは、ニコニコの公式外部開発者向けAPIとして安定保証されているものではない。  
将来変更される可能性がある。

そのため：

- API呼び出しは必ず1ファイルへ隔離する
- 失敗時にユーザーへ原因を表示する
- READMEに「ニコニコ側の仕様変更で動かなくなる可能性がある」と書く

### 19.2 Chrome Web Store公開時の説明

Chrome Web Storeへ出す場合、説明文に以下を明記する。

```text
nico pong は、ニコニコ生放送の番組ページ上で、ログイン済みブラウザセッションを利用して動画引用再生を支援します。
ニコニコのID・パスワード・Cookie値を収集しません。
動画リストや設定はブラウザ内に保存されます。
```

### 19.3 本番化前に確認すること

- ニコニコ利用規約との整合
- Chrome Web Storeポリシーとの整合
- host_permissionsの最小化
- Privacy Policyの用意
- エラー時に過剰な再試行をしないこと

---

## 20. まとめ

今回の修正の核心は以下。

```text
「動画紹介UIを探してクリック」ではなく、
「services-eapi.spi.nicovideo.jp の引用再生APIを叩く」
```

New NicoLive Helperの実装から、引用再生には以下のAPIが使えることが分かる。

```text
GET    /v1/tools/live/contents/{lvId}/quotation
POST   /v1/tools/live/contents/{lvId}/quotation
PATCH  /v1/tools/live/contents/{lvId}/quotation/contents
DELETE /v1/tools/live/contents/{lvId}/quotation
```

nico pongでは、このAPI呼び出しを `NicoLiveQuotationApi` に隔離し、Side Panelのリクエスト/ストック動画カードから直接呼ぶようにする。
