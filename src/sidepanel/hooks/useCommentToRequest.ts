import { useCallback, useRef } from "react";
import { extractKotehan, extractVideoIdsFromComment } from "../../shared/commentParsing";
import { checkRequestUserNg, checkVideoNg } from "../../shared/ngMatcher";
import { fetchNicoVideoInfo } from "../../shared/nicoVideoApi";
import { MSG_CHECK_QUOTE_AVAILABILITY } from "../../shared/messaging";
import type {
  CheckQuoteAvailabilityResult,
  NgRuleSet,
  NicoLiveComment,
  NicoPongTab,
  NicoPongVideo,
  NicoPongVideoDraft,
  RequestAcceptanceSettings,
} from "../../shared/types";
import type { CommentDebugActions } from "./useCommentDebug";

async function checkAvailability(
  videoId: string
): Promise<CheckQuoteAvailabilityResult> {
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_CHECK_QUOTE_AVAILABILITY,
      payload: { videoId },
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "CHECK_QUOTE_AVAILABILITY_RESULT"
    ) {
      return (res as { payload: CheckQuoteAvailabilityResult }).payload;
    }
    return { ok: false, errorMessage: "Service Workerから応答なし" };
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

type Deps = {
  acceptance: RequestAcceptanceSettings;
  ngRules: NgRuleSet;
  lists: { request: NicoPongVideo[]; stock: NicoPongVideo[] };
  addVideo: (
    tab: NicoPongTab,
    draft: NicoPongVideoDraft,
    options?: { allowDuplicate?: boolean }
  ) => Promise<NicoPongVideo>;
  resolveName: (
    userId: string | undefined,
    candidates: { nametag?: string; atName?: string }
  ) => Promise<{ name?: string }>;
  noteRequest: (userId: string | undefined) => Promise<void>;
  notify: (
    message: string,
    level: "info" | "error" | "success" | "warn"
  ) => void;
  // 切り分け用デバッグ (optional)。docs/nico-pong_comment_debug_instruction.md 参照。
  debug?: CommentDebugActions;
};

export function useCommentToRequest() {
  // 直近ハンドル中の動画IDを抑制
  const inflightVideoIds = useRef(new Set<string>());

  const handleComment = useCallback(
    async (comment: NicoLiveComment, deps: Deps): Promise<void> => {
      const ts = Date.now();
      if (deps.acceptance.requestAcceptMode !== "accept") {
        deps.debug?.recordEvent?.({
          stage: "request_add",
          ok: false,
          message: `skip: requestAcceptMode=${deps.acceptance.requestAcceptMode}`,
          timestamp: ts,
        });
        return;
      }
      if (!deps.acceptance.autoAcceptCommentRequests) {
        deps.debug?.recordEvent?.({
          stage: "request_add",
          ok: false,
          message: "skip: autoAcceptCommentRequests=false",
          timestamp: ts,
        });
        return;
      }

      // 生主/運営/自分自身のコメントはリクエスト扱いしない
      if (comment.isOperatorComment === true) {
        deps.debug?.recordEvent?.({
          stage: "request_add",
          ok: false,
          message: "skip: operator comment",
          timestamp: ts,
        });
        return;
      }
      if (comment.isOwnPost === true) {
        deps.debug?.recordEvent?.({
          stage: "request_add",
          ok: false,
          message: "skip: own post",
          timestamp: ts,
        });
        return;
      }

      // === デバッグ: 動画ID抽出前 ===
      deps.debug?.onBeforeParse(comment.text);

      const videoIds = extractVideoIdsFromComment(comment.text);

      // === デバッグ: 動画ID抽出結果 ===
      deps.debug?.onParseResult(comment.text, videoIds);

      if (videoIds.length === 0) return;
      console.info(
        "[nico-pong] video id detected",
        videoIds.join(","),
        `from comment no=${comment.no} user=${comment.userId || "-"}`
      );

      // NG リク主
      const userNg = checkRequestUserNg(
        comment.userId || undefined,
        deps.ngRules
      );
      if (userNg.ng) {
        deps.notify(
          `NGリク主のためスキップ: ${userNg.reason ?? ""}`,
          "warn"
        );
        return;
      }

      // 1人あたり最大数
      const reqs = deps.lists.request;
      if (comment.userId && deps.acceptance.maxRequestsPerUser > 0) {
        const userActive = reqs.filter(
          (v) =>
            v.requestUserId === comment.userId &&
            v.status !== "played" &&
            v.status !== "skipped" &&
            v.status !== "ng"
        ).length;
        if (userActive >= deps.acceptance.maxRequestsPerUser) {
          deps.notify(
            `1人あたり最大リクエスト数(${deps.acceptance.maxRequestsPerUser})に達しました`,
            "warn"
          );
          return;
        }
      }

      const atName = extractKotehan(comment.text) ?? undefined;
      const resolved = await deps.resolveName(comment.userId || undefined, {
        nametag: comment.name && comment.name.length > 0 ? comment.name : undefined,
        atName,
      });

      for (const videoId of videoIds) {
        // 重複防止
        if (deps.acceptance.preventDuplicateInRequest) {
          const dup = deps.lists.request.find((v) => v.videoId === videoId);
          if (dup) {
            deps.notify(`${videoId}: 既にリクエストにあります`, "info");
            // デバッグ: 重複は登録失敗として記録 (UI上に明示)
            deps.debug?.onAddRequestFailed(
              videoId,
              "既にリクエストにあります (重複)"
            );
            continue;
          }
        }
        if (inflightVideoIds.current.has(videoId)) continue;
        inflightVideoIds.current.add(videoId);
        try {
          // === デバッグ: 動画情報取得開始 ===
          deps.debug?.onBeforeFetch(videoId);

          const info = await fetchNicoVideoInfo(videoId);
          if (!info.ok) {
            deps.notify(
              `${videoId}: 動画情報取得失敗 (${info.errorMessage})`,
              "error"
            );
            // === デバッグ: 動画情報取得失敗 ===
            deps.debug?.onFetchFailed(videoId, info.errorMessage);
            continue;
          }
          // === デバッグ: 動画情報取得成功 ===
          deps.debug?.onFetchSuccess(videoId, {
            videoId: info.video.videoId,
            title: info.video.title,
            ownerName: info.video.ownerName,
            displayAuthorName: info.video.displayAuthorName,
            durationSec: info.video.durationSec,
          });

          // NG 動画チェック
          const draftForNgCheck: NicoPongVideo = {
            id: "",
            addedTo: "request",
            order: 0,
            addedAt: "",
            updatedAt: "",
            ...info.video,
          } as NicoPongVideo;
          const videoNg = checkVideoNg(draftForNgCheck, deps.ngRules);

          // 引用可否
          let quotable: boolean | undefined;
          try {
            const q = await checkAvailability(videoId);
            if (q.ok) quotable = q.quotable;
          } catch {
            // ignore
          }

          const draft: NicoPongVideoDraft = {
            ...info.video,
            quotable,
            noLivePlay:
              info.video.noLivePlay || quotable === false
                ? true
                : info.video.noLivePlay,
            status: videoNg.ng
              ? "ng"
              : quotable === false
              ? "no_live_play"
              : info.video.status ?? "queued",
            ngReason: videoNg.ng
              ? videoNg.reason
              : quotable === false
              ? "引用不可動画"
              : info.video.ngReason,
            sourceType: "comment",
            requestUserId: comment.userId || undefined,
            requestUserName: resolved.name,
            requestCommentNo: comment.no || undefined,
          };

          // === デバッグ: リクエスト登録前 ===
          deps.debug?.onBeforeAddRequest(videoId, {
            title: draft.title,
            status: draft.status,
            quotable: draft.quotable,
          });

          try {
            await deps.addVideo("request", draft, {
              allowDuplicate: !deps.acceptance.preventDuplicateInRequest,
            });
            await deps.noteRequest(comment.userId || undefined);
            console.info("[nico-pong] request added from comment", videoId);
            // === デバッグ: リクエスト登録成功 ===
            deps.debug?.onAddRequestSuccess(videoId, {
              title: draft.title,
            });
            const tag =
              resolved.name && resolved.name.length > 0
                ? `@${resolved.name}`
                : comment.userId || "";
            deps.notify(
              `${tag} のリクエストを追加: ${videoId}`,
              "success"
            );
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "保存失敗";
            if (err instanceof Error && err.message === "DUPLICATE_VIDEO") {
              deps.notify(`${videoId}: 既にリクエストにあります`, "info");
              deps.debug?.onAddRequestFailed(
                videoId,
                "既にリクエストにあります (DUPLICATE_VIDEO)"
              );
            } else {
              deps.notify(`${videoId}: 保存失敗 (${msg})`, "error");
              deps.debug?.onAddRequestFailed(videoId, msg);
            }
          }
        } finally {
          inflightVideoIds.current.delete(videoId);
        }
      }
    },
    []
  );

  return { handleComment };
}
