import { useCallback, useEffect, useMemo, useState } from "react";
import CommentConnectionPanel from "./components/CommentConnectionPanel";
import CommentSettingsPanel from "./components/CommentSettingsPanel";
import Header from "./components/Header";
import MylistImportForm from "./components/MylistImportForm";
import NgRulesPanel from "./components/NgRulesPanel";
import NowPlayingPanel from "./components/NowPlayingPanel";
import PlaybackModeToggle from "./components/PlaybackModeToggle";
import Tabs from "./components/Tabs";
import VideoInputForm from "./components/VideoInputForm";
import VideoList from "./components/VideoList";
import { useActiveTab } from "./hooks/useActiveTab";
import { useBroadcasterComment } from "./hooks/useBroadcasterComment";
import { useCommentProvider } from "./hooks/useCommentProvider";
import { useCommentSettings } from "./hooks/useCommentSettings";
import { useCommentToRequest } from "./hooks/useCommentToRequest";
import { useKotehan } from "./hooks/useKotehan";
import { useMylistImport } from "./hooks/useMylistImport";
import { useNgRules } from "./hooks/useNgRules";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { usePlaybackMode } from "./hooks/usePlaybackMode";
import { useProgramInfo } from "./hooks/useProgramInfo";
import { useRequestAcceptance } from "./hooks/useRequestAcceptance";
import { useVideoLists } from "./hooks/useVideoLists";
import type { NicoLiveComment, NicoPongTab, NicoPongVideo } from "../shared/types";

type ToastLevel = "info" | "error" | "success" | "warn";
type Toast = { level: ToastLevel; message: string } | null;

export default function App() {
  const { info, loading: programLoading, refresh: refreshProgram } =
    useProgramInfo();
  const { tab, setTab } = useActiveTab();
  const { mode, setMode } = usePlaybackMode();
  const {
    lists,
    error: listError,
    addVideo,
    deleteVideo,
    updateVideo,
    reorderVideos,
    updateVideoStatus,
    markPlayed,
    markUnplayable,
    moveToTab,
    copyToTab,
  } = useVideoLists();

  const { settings: commentSettings, update: updateCommentSettings } =
    useCommentSettings();
  const { settings: acceptance, update: updateAcceptance } =
    useRequestAcceptance();
  const { rules: ngRules, update: updateNgRules } = useNgRules();

  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((message: string, level: ToastLevel) => {
    setToast({ level, message });
  }, []);

  const { postVideoInfo } = useBroadcasterComment(notify);

  const handlePlaySuccess = useCallback(
    (params: { video: NicoPongVideo; lvId: string }) => {
      if (!commentSettings.autoPostVideoInfoOnPlay) return;
      const delay = Math.max(0, commentSettings.postDelayMs);
      setTimeout(() => {
        void postVideoInfo({
          video: params.video,
          lvId: params.lvId,
          settings: commentSettings,
        });
      }, delay);
    },
    [commentSettings, postVideoInfo]
  );

  const {
    playbackState,
    forcePlay,
    stop,
    skipNext,
    markCurrentPlayed,
  } = usePlaybackController({
    lists,
    mode,
    onUpdateStatus: updateVideoStatus,
    onMarkPlayed: markPlayed,
    onMarkUnplayable: markUnplayable,
    notify,
    onPlaySuccess: handlePlaySuccess,
  });

  const { progress: importProgress, importMylist } = useMylistImport(addVideo);

  // コメント → リクエスト連携
  const { resolveName, noteRequest } = useKotehan();
  const { handleComment } = useCommentToRequest();

  const handleCommentReceived = useCallback(
    (comment: NicoLiveComment) => {
      void handleComment(comment, {
        acceptance,
        ngRules,
        lists,
        addVideo,
        resolveName,
        noteRequest,
        notify,
      });
    },
    [
      acceptance,
      ngRules,
      lists,
      addVideo,
      resolveName,
      noteRequest,
      notify,
      handleComment,
    ]
  );

  const {
    status: commentStatus,
    error: commentError,
    recvCount: commentRecvCount,
    connect: connectComment,
    disconnect: disconnectComment,
  } = useCommentProvider(handleCommentReceived);

  // 起動時に自動接続
  useEffect(() => {
    void connectComment();
  }, [connectComment]);

  const currentPlayingVideo = useMemo<NicoPongVideo | null>(() => {
    const id = playbackState.currentVideoInternalId;
    if (!id) return null;
    return (
      lists.request.find((v) => v.id === id) ||
      lists.stock.find((v) => v.id === id) ||
      null
    );
  }, [playbackState.currentVideoInternalId, lists]);

  const handleManualBroadcasterPost = useCallback(async () => {
    if (!currentPlayingVideo) {
      notify("再生中の動画がありません", "warn");
      return;
    }
    await postVideoInfo({
      video: currentPlayingVideo,
      settings: commentSettings,
    });
  }, [currentPlayingVideo, notify, postVideoInfo, commentSettings]);

  const handleCopyToRequest = useCallback(
    async (_t: NicoPongTab, v: NicoPongVideo) => {
      try {
        await copyToTab(v.id, "request", "stock_copy", {
          allowDuplicate: !acceptance.preventDuplicateInRequest,
        });
        notify(`${v.videoId} をリクエストへコピーしました`, "success");
      } catch (err) {
        if (err instanceof Error && err.message === "DUPLICATE_VIDEO") {
          notify(`${v.videoId}: 既にリクエストにあります`, "info");
        } else {
          notify(
            err instanceof Error
              ? `コピー失敗: ${err.message}`
              : "コピー失敗",
            "error"
          );
        }
      }
    },
    [copyToTab, acceptance.preventDuplicateInRequest, notify]
  );

  const handleMoveToRequest = useCallback(
    async (fromTab: NicoPongTab, v: NicoPongVideo) => {
      try {
        await moveToTab(fromTab, v.id, "request", "stock_move", {
          allowDuplicate: !acceptance.preventDuplicateInRequest,
        });
        notify(`${v.videoId} をリクエストへ移動しました`, "success");
      } catch (err) {
        if (err instanceof Error && err.message === "DUPLICATE_VIDEO") {
          notify(`${v.videoId}: 既にリクエストにあります`, "info");
        } else {
          notify(
            err instanceof Error
              ? `移動失敗: ${err.message}`
              : "移動失敗",
            "error"
          );
        }
      }
    },
    [moveToTab, acceptance.preventDuplicateInRequest, notify]
  );

  return (
    <div className="app">
      <Header info={info} loading={programLoading} onRefresh={refreshProgram} />
      <NowPlayingPanel
        state={playbackState}
        onStop={() => void stop()}
        onSkip={() => void skipNext()}
        onMarkPlayed={() => void markCurrentPlayed()}
        onPostBroadcasterComment={() => void handleManualBroadcasterPost()}
        canPostComment={!!currentPlayingVideo}
      />
      <PlaybackModeToggle mode={mode} onChange={setMode} />
      <CommentConnectionPanel
        status={commentStatus}
        error={commentError}
        recvCount={commentRecvCount}
        acceptance={acceptance}
        onAcceptanceChange={updateAcceptance}
        onConnect={() => void connectComment()}
        onDisconnect={() => disconnectComment()}
      />
      <CommentSettingsPanel
        settings={commentSettings}
        onChange={updateCommentSettings}
      />
      <NgRulesPanel rules={ngRules} onChange={updateNgRules} />
      <VideoInputForm
        activeTab={tab}
        onAdd={async (t, draft) => {
          await addVideo(t, draft);
        }}
        notify={notify}
      />
      <MylistImportForm
        activeTab={tab}
        progress={importProgress}
        onImport={async (mylistId, target) => {
          const r = await importMylist(mylistId, target);
          if (r.ok) {
            notify(
              `mylist/${r.mylistId}: 追加${r.imported} / 重複${r.duplicated} / 失敗${r.failed}`,
              "success"
            );
          } else {
            notify(
              `マイリスト取得失敗: ${r.errorMessage ?? "不明"}`,
              "error"
            );
          }
        }}
      />
      <Tabs
        active={tab}
        onChange={setTab}
        counts={{ request: lists.request.length, stock: lists.stock.length }}
      />
      <VideoList
        tab={tab}
        videos={lists[tab]}
        currentVideoInternalId={playbackState.currentVideoInternalId}
        onDelete={async (t, id) => {
          try {
            await deleteVideo(t, id);
            notify("削除しました", "success");
          } catch (e) {
            notify(
              e instanceof Error ? `削除失敗: ${e.message}` : "削除失敗",
              "error"
            );
          }
        }}
        onUpdate={async (t, v) => {
          try {
            await updateVideo(t, v);
          } catch (e) {
            notify(
              e instanceof Error ? `更新失敗: ${e.message}` : "更新失敗",
              "error"
            );
          }
        }}
        onReorder={async (t, ids) => {
          try {
            await reorderVideos(t, ids);
            notify("並び替えを保存しました", "success");
          } catch (e) {
            notify(
              e instanceof Error
                ? `並び替え保存失敗: ${e.message}`
                : "並び替え保存失敗",
              "error"
            );
          }
        }}
        onForcePlay={async (t, v) => {
          await forcePlay(v, t === "request" ? "request" : "stock");
        }}
        onCopyToRequest={handleCopyToRequest}
        onMoveToRequest={handleMoveToRequest}
      />
      {listError ? (
        <div className="toast error" role="alert">
          {listError}
        </div>
      ) : null}
      {toast ? (
        <div className={`toast ${toast.level}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
