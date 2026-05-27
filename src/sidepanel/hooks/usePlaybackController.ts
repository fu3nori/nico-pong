import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NicoliveContext,
  NicoPongTab,
  NicoPongVideo,
  PlaybackMode,
  PlaybackSource,
  PlaybackState,
  PlayVideoResult,
  StopVideoResult,
  VideoItemStatus,
} from "../../shared/types";
import {
  MSG_GET_NICOLIVE_CONTEXT,
  MSG_PLAY_VIDEO,
  MSG_STOP_VIDEO,
} from "../../shared/messaging";
import { findNextPlayableRequest } from "../../shared/playback";

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

async function fetchNicoliveContext(): Promise<NicoliveContext> {
  const tabId = await findNicoliveTabId();
  if (tabId === null) {
    return {
      ok: false,
      errorMessage:
        "ニコ生番組ページのタブが見つかりません。https://live.nicovideo.jp/watch/lv... を開いてください。",
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
      errorMessage:
        "Content Scriptから番組情報を取得できませんでした。ニコ生ページを再読み込みしてください。",
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `Content Script通信失敗: ${e.message}`
          : "Content Scriptと通信できません。ニコ生ページが開かれているか確認してください。",
    };
  }
}

async function sendPlayToServiceWorker(
  video: NicoPongVideo,
  source: PlaybackSource,
  lvId: string
): Promise<PlayVideoResult> {
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_PLAY_VIDEO,
      payload: { video, source, force: true, lvId },
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "PLAY_VIDEO_RESULT"
    ) {
      return (res as { payload: PlayVideoResult }).payload;
    }
    return {
      ok: false,
      videoId: video.videoId,
      errorMessage:
        "Service Workerから応答がありません。拡張機能を再読み込みしてください。",
    };
  } catch (e) {
    return {
      ok: false,
      videoId: video.videoId,
      errorMessage:
        e instanceof Error
          ? `Service Worker通信失敗: ${e.message}`
          : "Service Workerと通信できません",
    };
  }
}

async function sendStopToServiceWorker(
  lvId: string
): Promise<StopVideoResult> {
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_STOP_VIDEO,
      payload: { lvId },
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "STOP_VIDEO_RESULT"
    ) {
      return (res as { payload: StopVideoResult }).payload;
    }
    return {
      ok: false,
      errorMessage:
        "Service Workerから応答がありません。拡張機能を再読み込みしてください。",
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `Service Worker通信失敗: ${e.message}`
          : "Service Workerと通信できません",
    };
  }
}

type Notify = (
  message: string,
  level: "info" | "error" | "success" | "warn"
) => void;

type OnPlaySuccess = (params: {
  video: NicoPongVideo;
  source: PlaybackSource;
  lvId: string;
}) => void;

type Options = {
  lists: Record<NicoPongTab, NicoPongVideo[]>;
  mode: PlaybackMode;
  onUpdateStatus: (
    tab: NicoPongTab,
    id: string,
    status: VideoItemStatus
  ) => Promise<void>;
  onMarkPlayed: (tab: NicoPongTab, id: string) => Promise<void>;
  onMarkUnplayable: (tab: NicoPongTab, id: string) => Promise<void>;
  notify: Notify;
  onPlaySuccess?: OnPlaySuccess;
};

// 引用再生APIが返すエラーのうち、再生不可と判断するパターン。
const UNPLAYABLE_ERROR_PATTERNS = [
  "引用再生できない動画",
  "引用再生できません",
  "コンテンツが存在しない",
  "存在しません",
  "権限がない",
];

function looksUnplayable(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return UNPLAYABLE_ERROR_PATTERNS.some((p) => errorMessage.includes(p));
}

const INITIAL_STATE: PlaybackState = { status: "idle" };

// 自動再生での連続エラー閾値。
const MAX_CONSECUTIVE_ERRORS = 5;
const AUTO_ERROR_NEXT_DELAY_MS = 2500;

function tabOf(source: PlaybackSource | undefined): NicoPongTab | null {
  return source === "request" ? "request" : source === "stock" ? "stock" : null;
}

export function usePlaybackController(opts: Options) {
  const {
    lists,
    mode,
    onUpdateStatus,
    onMarkPlayed,
    onMarkUnplayable,
    notify,
    onPlaySuccess,
  } = opts;
  const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
  const endTimerRef = useRef<number | null>(null);
  const errorRetryTimerRef = useRef<number | null>(null);
  const stateRef = useRef<PlaybackState>(INITIAL_STATE);
  const listsRef = useRef(lists);
  const modeRef = useRef(mode);
  const currentLvIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const autoLockedRef = useRef(false); // 連続エラーで自動再生を一時停止
  const inflightRef = useRef(false); // forcePlay 多重実行防止
  const onPlaySuccessRef = useRef<OnPlaySuccess | undefined>(onPlaySuccess);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    listsRef.current = lists;
  }, [lists]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    onPlaySuccessRef.current = onPlaySuccess;
  }, [onPlaySuccess]);

  const clearEndTimer = useCallback(() => {
    if (endTimerRef.current !== null) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);
  const clearErrorRetryTimer = useCallback(() => {
    if (errorRetryTimerRef.current !== null) {
      clearTimeout(errorRetryTimerRef.current);
      errorRetryTimerRef.current = null;
    }
  }, []);
  const clearAllTimers = useCallback(() => {
    clearEndTimer();
    clearErrorRetryTimer();
  }, [clearEndTimer, clearErrorRetryTimer]);

  const handleEnded = useCallback(async () => {
    const current = stateRef.current;
    if (!current.currentVideoInternalId) return;

    const internalId = current.currentVideoInternalId;
    const tab = tabOf(current.source);
    if (tab) {
      try {
        await onMarkPlayed(tab, internalId);
      } catch {
        // ignore
      }
    }

    setState({
      status: "ended",
      currentVideoInternalId: undefined,
      currentVideoId: current.currentVideoId,
      currentTitle: current.currentTitle,
      currentThumbnailUrl: current.currentThumbnailUrl,
      source: current.source,
      startedAt: current.startedAt,
      endedAt: new Date().toISOString(),
    });

    if (modeRef.current === "auto" && !autoLockedRef.current) {
      window.setTimeout(() => {
        void playNext();
      }, 0);
    }
  }, [onMarkPlayed]);

  const scheduleEndTimer = useCallback(
    (durationSec: number | undefined) => {
      clearEndTimer();
      if (!durationSec || durationSec <= 0) return;
      const ms = (durationSec + 2) * 1000;
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        void handleEnded();
      }, ms);
    },
    [clearEndTimer, handleEnded]
  );

  const forcePlay = useCallback(
    async (video: NicoPongVideo, source: PlaybackSource) => {
      if (inflightRef.current) {
        // 多重起動防止: 既に再生コマンド進行中
        return {
          ok: false as const,
          videoId: video.videoId,
          errorMessage: "他の再生処理が進行中です。少し待って再試行してください。",
        };
      }
      inflightRef.current = true;
      clearAllTimers();

      try {
        // 既存再生があれば interrupted に
        const current = stateRef.current;
        if (
          current.status === "playing" &&
          current.currentVideoInternalId &&
          current.currentVideoInternalId !== video.id
        ) {
          const prevTab = tabOf(current.source);
          if (prevTab) {
            try {
              await onUpdateStatus(
                prevTab,
                current.currentVideoInternalId,
                "interrupted"
              );
            } catch {
              // ignore
            }
          }
        }

        setState({
          status: "loading",
          currentVideoInternalId: video.id,
          currentVideoId: video.videoId,
          currentTitle: video.title,
          currentThumbnailUrl: video.thumbnailUrl,
          source,
          startedAt: new Date().toISOString(),
        });

        // 1. Content Script から lvId と生主権限を取得
        const ctx = await fetchNicoliveContext();
        if (!ctx.ok || !ctx.lvId) {
          const errMsg =
            ctx.errorMessage ?? "ニコ生番組情報を取得できませんでした。";
          setState({
            status: "error",
            currentVideoInternalId: video.id,
            currentVideoId: video.videoId,
            currentTitle: video.title,
            currentThumbnailUrl: video.thumbnailUrl,
            source,
            errorMessage: errMsg,
          });
          notify(errMsg, "error");
          return {
            ok: false as const,
            videoId: video.videoId,
            errorMessage: errMsg,
          };
        }
        if (ctx.isBroadcaster === false) {
          const errMsg =
            "生主権限を確認できません。放送者アカウントで番組ページを開いてください。";
          setState({
            status: "error",
            currentVideoInternalId: video.id,
            currentVideoId: video.videoId,
            currentTitle: video.title,
            currentThumbnailUrl: video.thumbnailUrl,
            source,
            errorMessage: errMsg,
          });
          notify(errMsg, "error");
          return {
            ok: false as const,
            videoId: video.videoId,
            errorMessage: errMsg,
          };
        }

        currentLvIdRef.current = ctx.lvId;

        // 2. Service Worker に引用再生APIの実行を依頼
        const result = await sendPlayToServiceWorker(video, source, ctx.lvId);

        if (!result.ok) {
          setState({
            status: "error",
            currentVideoInternalId: video.id,
            currentVideoId: video.videoId,
            currentTitle: video.title,
            currentThumbnailUrl: video.thumbnailUrl,
            source,
            errorMessage: result.errorMessage,
          });
          const tab = tabOf(source);
          if (tab) {
            try {
              if (looksUnplayable(result.errorMessage)) {
                await onMarkUnplayable(tab, video.id);
              } else {
                await onUpdateStatus(tab, video.id, "error");
              }
            } catch {
              // ignore
            }
          }
          notify(`${video.videoId}: ${result.errorMessage}`, "error");

          // 自動再生中なら次へ進む。連続エラーを記録。
          if (modeRef.current === "auto" && source === "request") {
            consecutiveErrorsRef.current += 1;
            if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
              autoLockedRef.current = true;
              notify(
                `自動再生を一時停止しました (連続エラー${consecutiveErrorsRef.current}件)`,
                "warn"
              );
            } else {
              clearErrorRetryTimer();
              errorRetryTimerRef.current = window.setTimeout(() => {
                errorRetryTimerRef.current = null;
                void playNext();
              }, AUTO_ERROR_NEXT_DELAY_MS);
            }
          }
          return result;
        }

        // 再生成功
        consecutiveErrorsRef.current = 0;
        const startedAt = result.startedAt;
        setState({
          status: "playing",
          currentVideoInternalId: video.id,
          currentVideoId: video.videoId,
          currentTitle: video.title,
          currentThumbnailUrl: video.thumbnailUrl,
          source,
          startedAt,
        });

        const tab = tabOf(source);
        if (tab === "request") {
          try {
            await onUpdateStatus(tab, video.id, "playing");
          } catch {
            // ignore
          }
        }

        scheduleEndTimer(video.durationSec);
        notify(`再生開始: ${video.title}`, "success");

        // 再生成功フック (主コメ自動投稿等)
        if (onPlaySuccessRef.current) {
          try {
            onPlaySuccessRef.current({ video, source, lvId: ctx.lvId });
          } catch {
            // ignore
          }
        }

        return result;
      } finally {
        inflightRef.current = false;
      }
    },
    [
      clearAllTimers,
      clearErrorRetryTimer,
      notify,
      onMarkUnplayable,
      onUpdateStatus,
      scheduleEndTimer,
    ]
  );

  const playNext = useCallback(async () => {
    if (modeRef.current !== "auto") return;
    if (autoLockedRef.current) return;
    const current = stateRef.current;
    if (current.status === "playing" || current.status === "loading") return;
    if (inflightRef.current) return;

    const next = findNextPlayableRequest(listsRef.current.request);
    if (!next) return;

    await forcePlay(next, "request");
  }, [forcePlay]);

  const stop = useCallback(async () => {
    clearAllTimers();
    const current = stateRef.current;

    // lvIdの取得: refにあればそれ、なければContent Scriptに問い合わせる
    let lvId = currentLvIdRef.current;
    if (!lvId) {
      const ctx = await fetchNicoliveContext();
      lvId = ctx.ok ? ctx.lvId ?? null : null;
    }

    let stopErrorMessage: string | undefined;
    if (!lvId) {
      stopErrorMessage = "lvIDが特定できません";
    } else {
      const stopRes = await sendStopToServiceWorker(lvId);
      if (!stopRes.ok) {
        stopErrorMessage = stopRes.errorMessage;
      }
    }

    if (current.currentVideoInternalId && current.source) {
      const tab = tabOf(current.source);
      if (tab) {
        try {
          await onUpdateStatus(
            tab,
            current.currentVideoInternalId,
            "interrupted"
          );
        } catch {
          // ignore
        }
      }
    }
    setState({ status: "idle" });
    currentLvIdRef.current = null;
    if (stopErrorMessage) {
      notify(`停止失敗: ${stopErrorMessage}`, "error");
    } else {
      notify("再生を停止しました", "info");
    }
  }, [clearAllTimers, notify, onUpdateStatus]);

  const skipNext = useCallback(async () => {
    clearAllTimers();
    const current = stateRef.current;
    if (current.currentVideoInternalId && current.source) {
      const tab = tabOf(current.source);
      if (tab) {
        try {
          await onUpdateStatus(tab, current.currentVideoInternalId, "skipped");
        } catch {
          // ignore
        }
      }
    }
    setState({ status: "idle" });
    if (modeRef.current === "auto" && !autoLockedRef.current) {
      await playNext();
    }
  }, [clearAllTimers, onUpdateStatus, playNext]);

  const markCurrentPlayed = useCallback(async () => {
    clearAllTimers();
    const current = stateRef.current;
    if (current.currentVideoInternalId && current.source) {
      const tab = tabOf(current.source);
      if (tab) {
        try {
          await onMarkPlayed(tab, current.currentVideoInternalId);
        } catch {
          // ignore
        }
      }
    }
    setState({ status: "idle" });
    notify("再生済みにしました", "info");
    if (modeRef.current === "auto" && !autoLockedRef.current) {
      await playNext();
    }
  }, [clearAllTimers, notify, onMarkPlayed, playNext]);

  // 自動再生ロック解除
  const resumeAutoPlayback = useCallback(() => {
    autoLockedRef.current = false;
    consecutiveErrorsRef.current = 0;
    if (modeRef.current === "auto") {
      void playNext();
    }
  }, [playNext]);

  // 自動再生 ON 切替・リクエストキュー変化・idle化のいずれでも次動画チェック
  useEffect(() => {
    if (mode !== "auto") return;
    if (autoLockedRef.current) return;
    if (state.status === "playing" || state.status === "loading") return;
    const next = findNextPlayableRequest(lists.request);
    if (!next) return;
    void forcePlay(next, "request");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, state.status, lists.request]);

  // モードが手動に切り替わったらタイマーキャンセル
  useEffect(() => {
    if (mode === "manual") {
      clearErrorRetryTimer();
      autoLockedRef.current = false;
      consecutiveErrorsRef.current = 0;
    }
  }, [mode, clearErrorRetryTimer]);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  return {
    playbackState: state,
    forcePlay,
    stop,
    skipNext,
    markCurrentPlayed,
    resumeAutoPlayback,
    autoLocked: autoLockedRef.current,
  };
}
