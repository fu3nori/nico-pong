import { useCallback, useRef } from "react";
import {
  MSG_GET_NICOLIVE_CONTEXT,
  MSG_POST_BROADCASTER_COMMENT,
} from "../../shared/messaging";
import { renderBroadcasterCommentTemplate } from "../../shared/templateRenderer";
import type {
  CommentSettings,
  NicoliveContext,
  NicoPongVideo,
  PostBroadcasterCommentResult,
} from "../../shared/types";

const NICOLIVE_URL_RE = /^https:\/\/live\.nicovideo\.jp\/watch\/lv\d+/;

async function findNicoliveTabId(): Promise<number | null> {
  try {
    const active = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const a = active[0];
    if (a?.id && a.url && NICOLIVE_URL_RE.test(a.url)) return a.id;
  } catch {
    // ignore
  }
  try {
    const all = await chrome.tabs.query({
      url: "https://live.nicovideo.jp/watch/lv*",
    });
    const t = all.find((x) => typeof x.id === "number");
    return t?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchNicoliveContextForPost(): Promise<NicoliveContext> {
  const tabId = await findNicoliveTabId();
  if (tabId === null) {
    return {
      ok: false,
      errorMessage:
        "ニコ生番組ページのタブが見つかりません。",
    };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: MSG_GET_NICOLIVE_CONTEXT,
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "NICOLIVE_CONTEXT_RESULT"
    ) {
      return (res as { payload: NicoliveContext }).payload;
    }
    return {
      ok: false,
      errorMessage: "Content Scriptから情報を取得できませんでした。",
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `Content Script通信失敗: ${e.message}`
          : "Content Script通信失敗",
    };
  }
}

async function sendPostToServiceWorker(payload: {
  lvId: string;
  csrfToken: string;
  text: string;
  command?: string;
  name?: string;
  isPermanent?: boolean;
}): Promise<PostBroadcasterCommentResult> {
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_POST_BROADCASTER_COMMENT,
      payload,
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "POST_BROADCASTER_COMMENT_RESULT"
    ) {
      return (res as { payload: PostBroadcasterCommentResult }).payload;
    }
    return {
      ok: false,
      errorMessage: "Service Workerから応答がありません。",
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `Service Worker通信失敗: ${e.message}`
          : "Service Worker通信失敗",
    };
  }
}

const MAX_BROADCASTER_COMMENT_LENGTH = 75;
const RATE_LIMIT_PATTERNS = [
  "リクエスト間隔が短",
  "rate",
  "TOO_MANY_REQUESTS",
];

function looksRateLimited(message: string | undefined): boolean {
  if (!message) return false;
  return RATE_LIMIT_PATTERNS.some((p) => message.includes(p));
}

// テンプレ展開後テキストを「 / 」境界で複数チャンクに分割する。
// 各チャンクは <= maxLen を満たし、貪欲にパッキングする。
// 単体で maxLen を超えるセグメントはそのチャンク内で生切りする (最終手段)。
export function splitBroadcasterComment(
  text: string,
  maxLen: number = MAX_BROADCASTER_COMMENT_LENGTH
): string[] {
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  // 「 / 」(半角スペース+スラッシュ+半角スペース) のみで分割する。
  // 注意: URL中の `://` や `/watch/` を割らないために literal split を使う
  //       (`/\s*\/\s*/` 正規表現にすると URL も切ってしまうので不可)。
  const parts = text.split(" / ").filter((p) => p.length > 0);
  if (parts.length === 0) return [text.slice(0, maxLen)];

  const chunks: string[] = [];
  let current = "";
  const joiner = " / ";

  for (const part of parts) {
    const candidate = current ? `${current}${joiner}${part}` : part;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (part.length <= maxLen) {
      current = part;
    } else {
      // 単体で長すぎる: 生切り
      for (let i = 0; i < part.length; i += maxLen) {
        chunks.push(part.slice(i, i + maxLen));
      }
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export type PostVideoInfoOptions = {
  video: NicoPongVideo;
  lvId?: string; // 既知なら渡す
  settings: CommentSettings;
};

type Notify = (
  message: string,
  level: "info" | "error" | "success" | "warn"
) => void;

export function useBroadcasterComment(notify: Notify) {
  // 直近の投稿時刻を保持して、過剰な連投を防ぐ
  const lastPostAtRef = useRef<number>(0);

  const postRaw = useCallback(
    async (params: {
      lvId?: string;
      text: string;
      command?: string;
      name?: string;
      isPermanent?: boolean;
    }): Promise<PostBroadcasterCommentResult> => {
      if (params.text.length === 0) {
        return { ok: false, errorMessage: "本文が空です" };
      }
      if (params.text.length > MAX_BROADCASTER_COMMENT_LENGTH) {
        return {
          ok: false,
          errorMessage: `本文が長すぎます (${params.text.length}/${MAX_BROADCASTER_COMMENT_LENGTH})`,
        };
      }

      let lvId = params.lvId;
      let csrfToken: string | undefined;
      const ctx = await fetchNicoliveContextForPost();
      if (!ctx.ok) {
        return {
          ok: false,
          errorMessage: ctx.errorMessage ?? "番組情報を取得できません",
        };
      }
      if (!lvId) lvId = ctx.lvId;
      csrfToken = ctx.csrfToken;
      if (!lvId) {
        return { ok: false, errorMessage: "lvIDが特定できません" };
      }
      if (!csrfToken) {
        return {
          ok: false,
          errorMessage:
            "csrfTokenが取得できません。番組ページを再読み込みしてください。",
        };
      }

      // 連投制御 (最低1秒空ける)
      const now = Date.now();
      const wait = Math.max(0, lastPostAtRef.current + 1000 - now);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }

      const maxAttempts = 3;
      let lastErr: PostBroadcasterCommentResult | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const result = await sendPostToServiceWorker({
          lvId,
          csrfToken,
          text: params.text,
          command: params.command,
          name: params.name,
          isPermanent: params.isPermanent,
        });
        lastPostAtRef.current = Date.now();
        if (result.ok) return result;
        lastErr = result;
        if (!looksRateLimited(result.errorMessage)) break;
        const backoff = 1500 * attempt;
        await new Promise((r) => setTimeout(r, backoff));
      }
      return (
        lastErr ?? { ok: false, errorMessage: "主コメ投稿に失敗しました" }
      );
    },
    []
  );

  const postVideoInfo = useCallback(
    async (opts: PostVideoInfoOptions): Promise<PostBroadcasterCommentResult> => {
      const text = renderBroadcasterCommentTemplate(
        opts.settings.template,
        opts.video
      );
      // テンプレ全文を「 / 」境界で分割し、各チャンクを順次投稿する。
      // 従来の「title+url だけにフォールバック」だと author 部分が消えるバグがあったため、
      // 内容を絶対に削らない方式に変更した (postRaw 内に 1秒スロットルあり)。
      const chunks = splitBroadcasterComment(
        text,
        MAX_BROADCASTER_COMMENT_LENGTH
      );
      // 投稿順を逆順にする (テンプレ末尾の URL チャンクを先に投稿し、
      // タイトル/作者は後続コメで表示する仕様)。
      chunks.reverse();
      if (chunks.length === 0) {
        const fail: PostBroadcasterCommentResult = {
          ok: false,
          errorMessage: "投稿テキストが空です",
        };
        notify(`主コメ投稿に失敗: ${fail.errorMessage}`, "error");
        return fail;
      }

      let lastResult: PostBroadcasterCommentResult = {
        ok: false,
        errorMessage: "送信なし",
      };
      let okCount = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const r = await postRaw({
          lvId: opts.lvId,
          text: chunk,
          command: opts.settings.defaultCommand,
          name: opts.settings.defaultName,
          isPermanent: opts.settings.defaultIsPermanent,
        });
        lastResult = r;
        if (!r.ok) {
          notify(
            `主コメ投稿に失敗 (${i + 1}/${chunks.length}): ${r.errorMessage}`,
            "error"
          );
          return r;
        }
        okCount += 1;
      }

      if (chunks.length === 1) {
        notify("主コメを投稿しました", "success");
      } else {
        notify(`主コメを${okCount}件分割投稿しました`, "success");
      }
      return lastResult;
    },
    [postRaw, notify]
  );

  return { postVideoInfo, postRaw };
}
