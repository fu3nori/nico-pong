import type {
  PostBroadcasterCommentRequest,
  PostBroadcasterCommentResult,
} from "../shared/types";

// 生主コメント (broadcaster_comment) 投稿API。
// 公式安定保証はないため、必ずこのファイルにのみ隔離する。
// CSRF トークンはメモリ上で受け取り、保存・ログ出力しない。

const ENDPOINT_BASE = "https://live2.nicovideo.jp";

function buildUrl(lvId: string): string {
  return `${ENDPOINT_BASE}/unama/api/v3/programs/${encodeURIComponent(
    lvId
  )}/broadcaster_comment`;
}

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function extractErrorMessage(
  text: string,
  fallback: string
): { errorMessage: string } {
  const parsed = safeJsonParse(text) as
    | {
        meta?: { errorCode?: string; errorMessage?: string; status?: number };
      }
    | undefined;
  const msg = parsed?.meta?.errorMessage;
  return { errorMessage: msg || fallback };
}

export async function postBroadcasterComment(
  req: PostBroadcasterCommentRequest
): Promise<PostBroadcasterCommentResult> {
  const form = new FormData();
  form.append("text", req.text);
  form.append("command", req.command ?? "");
  if (req.name && req.name.length > 0) {
    form.append("name", req.name);
  }
  form.append("isPermanent", String(Boolean(req.isPermanent)));

  let response: Response;
  try {
    response = await fetch(buildUrl(req.lvId), {
      method: "PUT",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Public-Api-Token": req.csrfToken,
        "X-From-NicoPong-Extension": "1",
      },
      body: form,
    });
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `主コメ投稿に失敗(ネットワーク): ${e.message}`
          : "主コメ投稿に失敗(ネットワーク)",
    };
  }

  const text = await response.text();

  if (!response.ok) {
    const err = extractErrorMessage(
      text,
      `主コメ投稿に失敗しました: HTTP ${response.status}`
    );
    return { ok: false, errorMessage: err.errorMessage, status: response.status };
  }

  return { ok: true, status: response.status };
}
