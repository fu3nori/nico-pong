import type {
  NicoPongVideo,
  PlayVideoResult,
  QuotationStatusResult,
  StopVideoResult,
} from "../shared/types";

// ニコ生「引用再生」APIを直接呼び出すクライアント。
// Manifest V3 の service worker から呼び出すこと。Content Script からは呼ばない（CORS回避）。
// 公式安定保証はないため、必ずこのファイルにのみ隔離する。
// Cookieは fetch credentials: "include" によりブラウザ通常セッションを利用するのみで、値は読まない。

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

type ApiErrorMeta = {
  errorMessage?: string;
  errorCode?: string;
};

function extractApiError(
  text: string,
  fallback: string
): { errorMessage: string; errorCode?: string } {
  const parsed = safeJsonParse(text) as
    | { meta?: ApiErrorMeta }
    | undefined;
  const errorCode = parsed?.meta?.errorCode;
  const errorMessage = parsed?.meta?.errorMessage;
  return {
    errorCode,
    errorMessage: errorMessage || fallback,
  };
}

const COMMON_HEADERS: HeadersInit = {
  Accept: "application/json",
  "X-From-NicoPong-Extension": "1",
};

export class NicoLiveQuotationApi {
  constructor(private readonly lvId: string) {}

  async getQuotationStatus(): Promise<QuotationStatusResult> {
    let response: Response;
    try {
      response = await fetch(buildQuotationUrl(this.lvId), {
        method: "GET",
        credentials: "include",
        headers: COMMON_HEADERS,
      });
    } catch (e) {
      return {
        ok: false,
        errorMessage:
          e instanceof Error
            ? `引用再生状態の取得に失敗(ネットワーク): ${e.message}`
            : "引用再生状態の取得に失敗(ネットワーク)",
      };
    }

    const rawText = await response.text();

    if (response.status === 404) {
      return { ok: true, exists: false, status: 404, rawText };
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
    const currentContentId = (
      raw as { currentContent?: { id?: string } } | undefined
    )?.currentContent?.id;

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

    type ContentItem = { id: string; type: "video" };
    type PlayBody = {
      contents: ContentItem[];
      layout?: {
        main: { source: "quote"; volume: number };
        sub: { isSoundOnly: boolean; source: "self"; volume: number };
      };
      repeat?: boolean;
      enableAddViewCount?: boolean;
    };

    const body: PlayBody = {
      contents: [{ id: video.videoId, type: "video" }],
    };

    if (!hasCurrentQuotation) {
      body.layout = {
        main: { source: "quote", volume: 1 },
        sub: { isSoundOnly: true, source: "self", volume: 1 },
      };
      body.repeat = false;
      body.enableAddViewCount = true;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          ...COMMON_HEADERS,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return {
        ok: false,
        videoId: video.videoId,
        errorMessage:
          e instanceof Error
            ? `引用再生の呼び出しに失敗(ネットワーク): ${e.message}`
            : "引用再生の呼び出しに失敗(ネットワーク)",
      };
    }

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
    let response: Response;
    try {
      response = await fetch(buildQuotationUrl(this.lvId), {
        method: "DELETE",
        credentials: "include",
        headers: {
          ...COMMON_HEADERS,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    } catch (e) {
      return {
        ok: false,
        errorMessage:
          e instanceof Error
            ? `引用再生停止に失敗(ネットワーク): ${e.message}`
            : "引用再生停止に失敗(ネットワーク)",
      };
    }

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
