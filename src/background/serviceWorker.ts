// Service Worker (Manifest V3)
// 役割:
//   - 拡張アイコンクリックで Side Panel を開けるようにする
//   - ニコ生「引用再生」APIへの fetch をすべてここで実行する (CORSと拡張権限の都合)
//   - マイリスト取得、引用可否チェック、生主コメント投稿もここで実行する
// 注意:
//   - DOMには触らない
//   - Cookie値を読まない (credentials: "include" でブラウザ既存セッションのみ利用)
//   - cookies permission を使わない
//   - CSRF トークンは受け取って即使用、保存・ログ出力しない

import { NicoLiveQuotationApi } from "./nicoLiveQuotationApi";
import { postBroadcasterComment } from "./nicoBroadcasterCommentApi";
import { fetchMylistVideoIds } from "./nicoMylistApi";
import { checkQuoteAvailability } from "./nicoQuoteAvailabilityApi";
import type {
  CheckQuoteAvailabilityResult,
  MylistFetchVideoIdsResult,
  NicoPongVideo,
  PlayVideoResult,
  PostBroadcasterCommentRequest,
  PostBroadcasterCommentResult,
  StopVideoResult,
} from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => {
      console.warn("[nico pong] setPanelBehavior failed", err);
    });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // ignore
    });
});

function isValidLvId(v: unknown): v is string {
  return typeof v === "string" && /^lv\d+$/.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: string }).type;

  if (type === "PLAY_VIDEO") {
    const payload = (message as {
      payload?: { video?: NicoPongVideo; lvId?: string };
    }).payload;
    const video = payload?.video;
    const lvId = payload?.lvId;
    if (!video || !isValidLvId(lvId)) {
      const failResult: PlayVideoResult = {
        ok: false,
        videoId: video?.videoId ?? "",
        errorMessage:
          "PLAY_VIDEO に必要な payload (lvId, video) が不足しています。",
      };
      sendResponse({ type: "PLAY_VIDEO_RESULT", payload: failResult });
      return false;
    }
    (async () => {
      const api = new NicoLiveQuotationApi(lvId);
      try {
        const result = await api.play(video);
        sendResponse({ type: "PLAY_VIDEO_RESULT", payload: result });
      } catch (e) {
        const errResult: PlayVideoResult = {
          ok: false,
          videoId: video.videoId,
          errorMessage:
            e instanceof Error
              ? `引用再生API呼び出しで例外: ${e.message}`
              : "引用再生API呼び出しで例外",
        };
        sendResponse({ type: "PLAY_VIDEO_RESULT", payload: errResult });
      }
    })();
    return true; // async response
  }

  if (type === "STOP_VIDEO") {
    const payload = (message as { payload?: { lvId?: string } }).payload;
    const lvId = payload?.lvId;
    if (!isValidLvId(lvId)) {
      const failResult: StopVideoResult = {
        ok: false,
        errorMessage: "STOP_VIDEO に必要な lvId が不足しています。",
      };
      sendResponse({ type: "STOP_VIDEO_RESULT", payload: failResult });
      return false;
    }
    (async () => {
      const api = new NicoLiveQuotationApi(lvId);
      try {
        const result = await api.stop();
        sendResponse({ type: "STOP_VIDEO_RESULT", payload: result });
      } catch (e) {
        const errResult: StopVideoResult = {
          ok: false,
          errorMessage:
            e instanceof Error
              ? `引用再生停止で例外: ${e.message}`
              : "引用再生停止で例外",
        };
        sendResponse({ type: "STOP_VIDEO_RESULT", payload: errResult });
      }
    })();
    return true;
  }

  if (type === "FETCH_MYLIST_VIDEO_IDS") {
    const payload = (message as { payload?: { mylistId?: string } }).payload;
    const mylistId = payload?.mylistId;
    if (!isNonEmptyString(mylistId) || !/^\d+$/.test(mylistId)) {
      const fail: MylistFetchVideoIdsResult = {
        ok: false,
        mylistId: mylistId ?? "",
        errorMessage:
          "FETCH_MYLIST_VIDEO_IDS に有効なmylistIdが必要です。",
      };
      sendResponse({
        type: "FETCH_MYLIST_VIDEO_IDS_RESULT",
        payload: fail,
      });
      return false;
    }
    (async () => {
      try {
        const result = await fetchMylistVideoIds(mylistId);
        sendResponse({
          type: "FETCH_MYLIST_VIDEO_IDS_RESULT",
          payload: result,
        });
      } catch (e) {
        const err: MylistFetchVideoIdsResult = {
          ok: false,
          mylistId,
          errorMessage:
            e instanceof Error
              ? `マイリスト取得で例外: ${e.message}`
              : "マイリスト取得で例外",
        };
        sendResponse({
          type: "FETCH_MYLIST_VIDEO_IDS_RESULT",
          payload: err,
        });
      }
    })();
    return true;
  }

  if (type === "POST_BROADCASTER_COMMENT") {
    const payload = (message as {
      payload?: PostBroadcasterCommentRequest;
    }).payload;
    if (
      !payload ||
      !isValidLvId(payload.lvId) ||
      !isNonEmptyString(payload.csrfToken) ||
      !isNonEmptyString(payload.text)
    ) {
      const fail: PostBroadcasterCommentResult = {
        ok: false,
        errorMessage:
          "POST_BROADCASTER_COMMENT に必要な payload (lvId, csrfToken, text) が不足しています。",
      };
      sendResponse({
        type: "POST_BROADCASTER_COMMENT_RESULT",
        payload: fail,
      });
      return false;
    }
    (async () => {
      try {
        const result = await postBroadcasterComment(payload);
        sendResponse({
          type: "POST_BROADCASTER_COMMENT_RESULT",
          payload: result,
        });
      } catch (e) {
        const err: PostBroadcasterCommentResult = {
          ok: false,
          errorMessage:
            e instanceof Error
              ? `主コメ投稿で例外: ${e.message}`
              : "主コメ投稿で例外",
        };
        sendResponse({
          type: "POST_BROADCASTER_COMMENT_RESULT",
          payload: err,
        });
      }
    })();
    return true;
  }

  if (type === "CHECK_QUOTE_AVAILABILITY") {
    const payload = (message as { payload?: { videoId?: string } }).payload;
    const videoId = payload?.videoId;
    if (!isNonEmptyString(videoId)) {
      const fail: CheckQuoteAvailabilityResult = {
        ok: false,
        errorMessage:
          "CHECK_QUOTE_AVAILABILITY に videoId が必要です。",
      };
      sendResponse({
        type: "CHECK_QUOTE_AVAILABILITY_RESULT",
        payload: fail,
      });
      return false;
    }
    (async () => {
      try {
        const result = await checkQuoteAvailability(videoId);
        sendResponse({
          type: "CHECK_QUOTE_AVAILABILITY_RESULT",
          payload: result,
        });
      } catch (e) {
        const err: CheckQuoteAvailabilityResult = {
          ok: false,
          errorMessage:
            e instanceof Error
              ? `引用可否チェックで例外: ${e.message}`
              : "引用可否チェックで例外",
        };
        sendResponse({
          type: "CHECK_QUOTE_AVAILABILITY_RESULT",
          payload: err,
        });
      }
    })();
    return true;
  }

  return false;
});
