// Content Script: live.nicovideo.jp/watch/lv* に注入される。
// 役割は読み取り専用:
//   - 番組情報 (lvId, タイトル) を取得して返す
//   - #embedded-data から lvId / 生主権限 / csrfToken / WebSocketURL を取得して返す
//   - 取得に失敗した場合でも、初期データの構造を introspection して返す (デバッグ用)
//
// 引用再生API等への fetch は service worker 側で行う (CORS回避)。
//
// 注意:
//   - csrfToken は side panel / service worker へ「使う直前に渡す」だけにする。
//   - 保存しない。ログ出力しない。

type ProgramConnectionStatus =
  | "not_nicolive_page"
  | "detected"
  | "unknown"
  | "error";

type ProgramInfo = {
  status: ProgramConnectionStatus;
  lvId?: string;
  title?: string;
  url?: string;
  detectedAt: string;
  errorMessage?: string;
  isBroadcaster?: boolean;
};

type EmbeddedRoot = {
  program?: { nicoliveProgramId?: string; title?: string };
  user?: { isBroadcaster?: boolean; isOperator?: boolean };
  site?: {
    relive?: { csrfToken?: string; webSocketUrl?: string };
  };
};

type WebSocketUrlCandidate = { path: string; value: string };

function normalizeNicoliveTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*ニコニコ生放送\s*$/u, "")
    .replace(/\s*\|\s*ニコニコ生放送\s*$/u, "")
    .trim();
}

function detectEmbeddedData(): EmbeddedRoot | null {
  try {
    const el = document.querySelector("#embedded-data");
    const json = el?.getAttribute("data-props");
    if (!json) return null;
    return JSON.parse(json) as EmbeddedRoot;
  } catch {
    return null;
  }
}

function detectLvId(): string | null {
  const m = location.pathname.match(/\/watch\/(lv\d+)/);
  return m?.[1] ?? null;
}

function isBroadcasterContext(data: EmbeddedRoot | null): boolean {
  return (
    data?.user?.isBroadcaster === true || data?.user?.isOperator === true
  );
}

// ====== デバッグ用 introspection ======
// #embedded-data 探索の各段階を独立に返す。これにより
// 「DOMに要素はあるか」「data-props 属性はあるか」「JSON parse 成功か」を
// 区別して原因分離できる。
type EmbeddedIntrospection = {
  embeddedDataFound: boolean;
  dataPropsFound: boolean;
  dataPropsParsed: boolean;
  rootKeys: string[];
  parseError?: string;
  parsedRoot: unknown;
};

function introspectEmbedded(): EmbeddedIntrospection {
  const el = document.querySelector("#embedded-data");
  if (!el) {
    return {
      embeddedDataFound: false,
      dataPropsFound: false,
      dataPropsParsed: false,
      rootKeys: [],
      parsedRoot: null,
    };
  }
  const json = el.getAttribute("data-props");
  if (!json) {
    return {
      embeddedDataFound: true,
      dataPropsFound: false,
      dataPropsParsed: false,
      rootKeys: [],
      parsedRoot: null,
    };
  }
  try {
    const parsed = JSON.parse(json);
    const rootKeys =
      parsed && typeof parsed === "object"
        ? Object.keys(parsed)
        : [];
    return {
      embeddedDataFound: true,
      dataPropsFound: true,
      dataPropsParsed: true,
      rootKeys,
      parsedRoot: parsed,
    };
  } catch (e) {
    return {
      embeddedDataFound: true,
      dataPropsFound: true,
      dataPropsParsed: false,
      rootKeys: [],
      parseError: e instanceof Error ? e.message : String(e),
      parsedRoot: null,
    };
  }
}

// 任意のオブジェクトを再帰的に走査し ws:// / wss:// で始まる string を全て列挙する。
function findWebSocketUrls(
  value: unknown,
  path: string = "",
  results: WebSocketUrlCandidate[] = [],
  maxResults: number = 30,
  maxDepth: number = 12,
  depth: number = 0
): WebSocketUrlCandidate[] {
  if (results.length >= maxResults) return results;
  if (depth > maxDepth) return results;
  if (value == null) return results;

  if (typeof value === "string") {
    if (value.startsWith("ws://") || value.startsWith("wss://")) {
      results.push({ path, value });
    }
    return results;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      findWebSocketUrls(
        value[i],
        path ? `${path}[${i}]` : `[${i}]`,
        results,
        maxResults,
        maxDepth,
        depth + 1
      );
      if (results.length >= maxResults) break;
    }
    return results;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      findWebSocketUrls(
        v,
        path ? `${path}.${k}` : k,
        results,
        maxResults,
        maxDepth,
        depth + 1
      );
      if (results.length >= maxResults) break;
    }
    return results;
  }
  return results;
}

// site.relive.webSocketUrl を最優先で、見つからなければ候補のうち
// nicovideo / dwango 系ドメインを次点で、最後は候補リスト先頭を採用。
function pickBestWebSocketUrl(
  candidates: WebSocketUrlCandidate[]
): string | undefined {
  if (candidates.length === 0) return undefined;
  const exact = candidates.find(
    (c) => c.path === "site.relive.webSocketUrl"
  );
  if (exact) return exact.value;
  const nico = candidates.find(
    (c) =>
      c.value.includes("nicovideo.jp") || c.value.includes("dwango")
  );
  if (nico) return nico.value;
  return candidates[0].value;
}

function detectProgramInfo(): ProgramInfo {
  try {
    const lvId = detectLvId();
    if (!lvId) {
      return {
        status: "not_nicolive_page",
        detectedAt: new Date().toISOString(),
        url: location.href,
      };
    }

    const embedded = detectEmbeddedData();
    const ogTitle = document
      .querySelector<HTMLMetaElement>('meta[property="og:title"]')
      ?.content?.trim();
    const docTitle = document.title?.trim();
    const rawTitle =
      embedded?.program?.title ||
      (ogTitle && ogTitle.length > 0 ? ogTitle : docTitle) ||
      lvId;
    const title = normalizeNicoliveTitle(rawTitle);

    return {
      status: "detected",
      lvId,
      title,
      url: location.href,
      detectedAt: new Date().toISOString(),
      isBroadcaster: isBroadcasterContext(embedded),
    };
  } catch (e) {
    return {
      status: "error",
      detectedAt: new Date().toISOString(),
      url: location.href,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: string }).type;

  if (type === "GET_PROGRAM_INFO") {
    const info = detectProgramInfo();
    sendResponse({ type: "PROGRAM_INFO_RESULT", payload: info });
    return false;
  }

  if (type === "GET_NICOLIVE_CONTEXT") {
    const lvId = detectLvId();
    const intro = introspectEmbedded();
    const parsed = intro.parsedRoot;

    // webSocketUrl 候補を全部列挙
    const candidates: WebSocketUrlCandidate[] = parsed
      ? findWebSocketUrls(parsed)
      : [];

    // 互換: site.relive.webSocketUrl を最優先、それ以外も候補から拾う
    const reliveExact =
      (parsed as EmbeddedRoot | null)?.site?.relive?.webSocketUrl;
    const webSocketUrl = reliveExact || pickBestWebSocketUrl(candidates);
    const csrfToken =
      (parsed as EmbeddedRoot | null)?.site?.relive?.csrfToken;

    if (!lvId) {
      sendResponse({
        type: "NICOLIVE_CONTEXT_RESULT",
        payload: {
          ok: false,
          errorMessage:
            "lvIDを取得できません。ニコ生番組ページを開いてください。",
          embeddedDataFound: intro.embeddedDataFound,
          dataPropsFound: intro.dataPropsFound,
          dataPropsParsed: intro.dataPropsParsed,
          rootKeys: intro.rootKeys,
          dataPropsParseError: intro.parseError,
          webSocketUrlCandidates: candidates,
        },
      });
      return false;
    }

    sendResponse({
      type: "NICOLIVE_CONTEXT_RESULT",
      payload: {
        ok: true,
        lvId,
        isBroadcaster: isBroadcasterContext(parsed as EmbeddedRoot | null),
        programTitle: (parsed as EmbeddedRoot | null)?.program?.title,
        csrfToken,
        webSocketUrl,
        embeddedDataFound: intro.embeddedDataFound,
        dataPropsFound: intro.dataPropsFound,
        dataPropsParsed: intro.dataPropsParsed,
        rootKeys: intro.rootKeys,
        dataPropsParseError: intro.parseError,
        webSocketUrlCandidates: candidates,
      },
    });
    return false;
  }

  return false;
});
