import type { CheckQuoteAvailabilityResult } from "../shared/types";

// 引用可否チェックAPI。
// 公式安定保証はないため、必ずこのファイルにのみ隔離する。

const ENDPOINT_BASE = "https://services-eapi.spi.nicovideo.jp";

function buildUrl(videoId: string): string {
  return `${ENDPOINT_BASE}/v1/tools/live/quote/services/video/contents/${encodeURIComponent(
    videoId
  )}`;
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export async function checkQuoteAvailability(
  videoId: string
): Promise<CheckQuoteAvailabilityResult> {
  let response: Response;
  try {
    response = await fetch(buildUrl(videoId), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-From-NicoPong-Extension": "1",
      },
    });
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `引用可否チェック失敗(ネットワーク): ${e.message}`
          : "引用可否チェック失敗(ネットワーク)",
    };
  }

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      quotable: false,
      errorMessage: `引用可否チェック失敗: HTTP ${response.status}`,
    };
  }

  const json = safeJsonParse(text) as
    | { data?: { quotable?: boolean } }
    | undefined;

  return {
    ok: true,
    quotable: Boolean(json?.data?.quotable),
  };
}
