// コメント取得→動画ID抽出→動画情報取得→リクエスト登録 の各段階を
// UI 上で可視化するための切り分け用デバッグフック。
// 参照: docs/nico-pong_comment_debug_instruction.md
//       docs/nico-pong_nicolive_comment_debug_plan.md
//
// 各 action は console.log/error も併用する。
// ログ接頭辞: [nico-pong][comment-debug]

import { useMemo, useState } from "react";
import {
  COMMENT_DEBUG_EVENT_LOG_LIMIT,
  INITIAL_COMMENT_DEBUG_STATE,
  type CommentDebugState,
  type CommentDebugWatcherStatus,
  type NicoLiveComment,
  type NicoPongDebugEvent,
  type WebSocketUrlCandidate,
} from "../../shared/types";

const LOG_PREFIX = "[nico-pong][comment-debug]";

export type EmbeddedDataIntrospection = {
  programIdFromUrl?: string;
  embeddedDataFound?: boolean;
  dataPropsFound?: boolean;
  dataPropsParsed?: boolean;
  rootKeys: string[];
  parseError?: string;
};

export type CommentDebugActions = {
  // 既存
  setWatcherStatus(status: CommentDebugWatcherStatus, message?: string): void;
  onCommentReceived(comment: NicoLiveComment): void;
  onBeforeParse(text: string): void;
  onParseResult(text: string, videoIds: string[]): void;
  onBeforeFetch(videoId: string): void;
  onFetchSuccess(videoId: string, info: unknown): void;
  onFetchFailed(videoId: string, errorMessage: string): void;
  onBeforeAddRequest(videoId: string, videoInfo: unknown): void;
  onAddRequestSuccess(videoId: string, videoInfo: unknown): void;
  onAddRequestFailed(videoId: string, errorMessage: string): void;
  reset(): void;
  // stale error をクリアする (connect 成功後などに呼ぶ)
  clearError(): void;

  // 新: introspection
  recordEmbeddedIntrospection(intro: EmbeddedDataIntrospection): void;
  recordWebSocketCandidates(candidates: WebSocketUrlCandidate[]): void;
  setSelectedWebSocketUrl(url: string | undefined): void;

  // 新: lifecycle (provider が emit したイベントを一括処理)
  recordEvent(event: NicoPongDebugEvent): void;
};

function pushEvent(
  events: NicoPongDebugEvent[],
  ev: NicoPongDebugEvent
): NicoPongDebugEvent[] {
  const next = [...events, ev];
  if (next.length > COMMENT_DEBUG_EVENT_LOG_LIMIT) {
    return next.slice(next.length - COMMENT_DEBUG_EVENT_LOG_LIMIT);
  }
  return next;
}

export function useCommentDebug(): {
  state: CommentDebugState;
  actions: CommentDebugActions;
} {
  const [state, setState] = useState<CommentDebugState>(
    INITIAL_COMMENT_DEBUG_STATE
  );

  const actions = useMemo<CommentDebugActions>(() => {
    const a: CommentDebugActions = {
      setWatcherStatus(status, message) {
        console.log(`${LOG_PREFIX} watcher status`, status, message ?? "");
        setState((prev) => ({
          ...prev,
          watcherStatus: status,
          lastError:
            status === "error" && message ? message : prev.lastError,
        }));
      },
      onCommentReceived(comment) {
        console.log(`${LOG_PREFIX} comment received`, {
          no: comment.no,
          userId: comment.userId,
          name: comment.name,
          text: comment.text,
          isOperatorComment: comment.isOperatorComment,
        });
        setState((prev) => ({
          ...prev,
          receivedCount: prev.receivedCount + 1,
          lastReceivedAt: new Date().toISOString(),
          lastCommentText: comment.text,
          lastUserId: comment.userId || undefined,
          lastUserName:
            comment.name && comment.name.length > 0
              ? comment.name
              : undefined,
          events: pushEvent(prev.events, {
            stage: "comment",
            ok: true,
            message: `recv no=${comment.no} text=${comment.text}`,
            timestamp: Date.now(),
          }),
        }));
      },
      onBeforeParse(text) {
        console.log(`${LOG_PREFIX} before video id parse`, { text });
      },
      onParseResult(text, videoIds) {
        if (videoIds.length > 0) {
          console.log(`${LOG_PREFIX} video id parsed`, {
            videoId: videoIds[0],
            allIds: videoIds,
            originalText: text,
          });
          setState((prev) => ({
            ...prev,
            lastParseStatus: "success",
            lastVideoId: videoIds[0],
            parsedVideoIdCount: prev.parsedVideoIdCount + videoIds.length,
            events: pushEvent(prev.events, {
              stage: "video_id_extract",
              ok: true,
              message: `抽出: ${videoIds.join(",")}`,
              timestamp: Date.now(),
            }),
          }));
        } else {
          console.log(`${LOG_PREFIX} no video id found`, {
            originalText: text,
          });
          setState((prev) => ({
            ...prev,
            lastParseStatus: "failed",
            lastVideoId: undefined,
            events: pushEvent(prev.events, {
              stage: "video_id_extract",
              ok: false,
              message: `動画IDなし: ${text.slice(0, 40)}`,
              timestamp: Date.now(),
            }),
          }));
        }
      },
      onBeforeFetch(videoId) {
        console.log(`${LOG_PREFIX} fetching video info`, { videoId });
        setState((prev) => ({
          ...prev,
          lastVideoInfoStatus: "fetching",
          lastVideoId: videoId,
        }));
      },
      onFetchSuccess(videoId, info) {
        console.log(`${LOG_PREFIX} video info fetched`, { videoId, info });
        setState((prev) => ({
          ...prev,
          lastVideoInfoStatus: "success",
          lastVideoId: videoId,
          events: pushEvent(prev.events, {
            stage: "video_info",
            ok: true,
            message: `${videoId} 動画情報取得成功`,
            timestamp: Date.now(),
          }),
        }));
      },
      onFetchFailed(videoId, errorMessage) {
        console.error(`${LOG_PREFIX} failed to fetch video info`, {
          videoId,
          errorMessage,
        });
        setState((prev) => ({
          ...prev,
          lastVideoInfoStatus: "failed",
          lastError: `[fetch ${videoId}] ${errorMessage}`,
          events: pushEvent(prev.events, {
            stage: "video_info",
            ok: false,
            message: `${videoId} 動画情報取得失敗: ${errorMessage}`,
            timestamp: Date.now(),
          }),
        }));
      },
      onBeforeAddRequest(videoId, videoInfo) {
        console.log(`${LOG_PREFIX} before add request`, {
          videoId,
          videoInfo,
        });
      },
      onAddRequestSuccess(videoId, videoInfo) {
        console.log(`${LOG_PREFIX} request added`, { videoId, videoInfo });
        setState((prev) => ({
          ...prev,
          lastRequestStatus: "success",
          requestAddedCount: prev.requestAddedCount + 1,
          events: pushEvent(prev.events, {
            stage: "request_add",
            ok: true,
            message: `${videoId} 登録成功`,
            timestamp: Date.now(),
          }),
        }));
      },
      onAddRequestFailed(videoId, errorMessage) {
        console.error(`${LOG_PREFIX} failed to add request`, {
          videoId,
          errorMessage,
        });
        setState((prev) => ({
          ...prev,
          lastRequestStatus: "failed",
          lastError: `[add ${videoId}] ${errorMessage}`,
          events: pushEvent(prev.events, {
            stage: "request_add",
            ok: false,
            message: `${videoId} 登録失敗: ${errorMessage}`,
            timestamp: Date.now(),
          }),
        }));
      },
      reset() {
        console.log(`${LOG_PREFIX} debug state reset`);
        setState(INITIAL_COMMENT_DEBUG_STATE);
      },

      clearError() {
        setState((prev) => ({ ...prev, lastError: undefined }));
      },

      recordEmbeddedIntrospection(intro) {
        console.log(`${LOG_PREFIX} embedded data introspection`, intro);
        setState((prev) => ({
          ...prev,
          programIdFromUrl: intro.programIdFromUrl ?? prev.programIdFromUrl,
          embeddedDataFound: intro.embeddedDataFound,
          dataPropsFound: intro.dataPropsFound,
          dataPropsParsed: intro.dataPropsParsed,
          rootKeys: intro.rootKeys,
          dataPropsParseError: intro.parseError,
          events: pushEvent(prev.events, {
            stage: "embedded_data",
            ok: !!intro.dataPropsParsed,
            message: `el=${intro.embeddedDataFound} props=${intro.dataPropsFound} parsed=${intro.dataPropsParsed} keys=[${intro.rootKeys.join(",")}]${intro.parseError ? ` err=${intro.parseError}` : ""}`,
            timestamp: Date.now(),
          }),
        }));
      },

      recordWebSocketCandidates(candidates) {
        console.log(`${LOG_PREFIX} websocket url candidates`, candidates);
        setState((prev) => ({
          ...prev,
          webSocketUrlCandidates: candidates,
          events: pushEvent(prev.events, {
            stage: "websocket_url",
            ok: candidates.length > 0,
            message: `候補数=${candidates.length}${candidates[0] ? ` 先頭=${candidates[0].path}` : ""}`,
            timestamp: Date.now(),
          }),
        }));
      },

      setSelectedWebSocketUrl(url) {
        setState((prev) => ({
          ...prev,
          selectedWebSocketUrl: url,
        }));
      },

      recordEvent(event) {
        // ライフサイクル系イベントを状態フィールドへ反映 + イベントログへ push
        setState((prev) => {
          let next: CommentDebugState = {
            ...prev,
            events: pushEvent(prev.events, event),
          };
          switch (event.stage) {
            case "watch_ws_connect":
              next.watchWsState = event.ok ? "open" : "error";
              break;
            case "watch_ws_close":
              next.watchWsState = "closed";
              break;
            case "watch_ws_error":
              next.watchWsState = "error";
              if (!next.lastError) next.lastError = event.message;
              break;
            case "start_watching":
              if (event.ok) {
                next.startWatchingSentCount = prev.startWatchingSentCount + 1;
              }
              break;
            case "seat":
              if (event.ok) next.seatReceivedCount = prev.seatReceivedCount + 1;
              break;
            case "keep_seat":
              if (event.ok) next.keepSeatSentCount = prev.keepSeatSentCount + 1;
              break;
            case "ping":
              if (event.ok) next.pingReceivedCount = prev.pingReceivedCount + 1;
              break;
            case "pong":
              if (event.ok) next.pongSentCount = prev.pongSentCount + 1;
              break;
            case "message_server":
              next.messageServerReceivedCount =
                prev.messageServerReceivedCount + 1;
              break;
            case "view_uri":
              if (event.ok) {
                const url = (event.detail as { uri?: string } | undefined)?.uri;
                next.lastViewUri =
                  url || event.message.replace(/^viewUri取得:\s*/, "") || next.lastViewUri;
              }
              break;
            case "message_stream":
              if (event.ok) {
                next.messageStreamOpenCount = prev.messageStreamOpenCount + 1;
                // detail.label / atParam を覚える
                const d = event.detail as
                  | { label?: string; url?: string; atParam?: string }
                  | undefined;
                if (d?.label) next.lastStreamLabel = d.label;
                if (d?.url) next.lastStreamUrl = d.url;
                if (d?.atParam !== undefined) next.lastStreamAtParam = d.atParam;
              }
              break;
            case "stream_response_meta": {
              const d = event.detail as
                | {
                    label?: string;
                    status?: number;
                    contentType?: string;
                    atParam?: string;
                  }
                | undefined;
              if (d?.label) next.lastStreamLabel = d.label;
              if (typeof d?.status === "number") next.lastStreamHttpStatus = d.status;
              if (d?.contentType) next.lastStreamContentType = d.contentType;
              if (d?.atParam !== undefined) next.lastStreamAtParam = d.atParam;
              break;
            }
            case "stream_hexdump": {
              // event.message が hex 文字列を含む
              next.lastStreamHexDump = event.message;
              break;
            }
            case "stream_response_end": {
              const d = event.detail as
                | { label?: string; totalBytes?: number; durationMs?: number }
                | undefined;
              if (d?.label) next.lastStreamLabel = d.label;
              if (typeof d?.totalBytes === "number")
                next.lastStreamTotalBytes = d.totalBytes;
              if (typeof d?.durationMs === "number")
                next.lastStreamDurationMs = d.durationMs;
              break;
            }
            case "decode_ok":
              next.decodeOkCount = prev.decodeOkCount + 1;
              break;
            case "decode_fail":
              next.decodeFailCount = prev.decodeFailCount + 1;
              if (!event.ok) next.lastError = event.message;
              break;
            case "request_add":
              // recordEvent 経由のスキップ/失敗 (videoId 不明の early return など)
              if (!event.ok) next.lastError = event.message;
              break;
            case "error":
              if (!next.lastError) next.lastError = event.message;
              break;
            default:
              break;
          }
          return next;
        });
        // コンソールには ok 状況で出し分け
        if (event.ok) {
          console.log(`${LOG_PREFIX} [${event.stage}]`, event.message);
        } else {
          console.warn(`${LOG_PREFIX} [${event.stage}] FAILED`, event.message);
        }
      },
    };
    return a;
  }, []);

  return { state, actions };
}
