import { useCallback, useState } from "react";
import {
  MSG_CHECK_QUOTE_AVAILABILITY,
  MSG_FETCH_MYLIST_VIDEO_IDS,
} from "../../shared/messaging";
import { fetchNicoVideoInfo } from "../../shared/nicoVideoApi";
import type {
  CheckQuoteAvailabilityResult,
  ImportTarget,
  MylistFetchVideoIdsResult,
  MylistImportResult,
  NicoPongTab,
  NicoPongVideo,
  NicoPongVideoDraft,
} from "../../shared/types";

async function requestMylistVideoIds(
  mylistId: string,
  target: ImportTarget
): Promise<MylistFetchVideoIdsResult> {
  try {
    const res = await chrome.runtime.sendMessage({
      type: MSG_FETCH_MYLIST_VIDEO_IDS,
      payload: { mylistId, target },
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "FETCH_MYLIST_VIDEO_IDS_RESULT"
    ) {
      return (res as { payload: MylistFetchVideoIdsResult }).payload;
    }
    return {
      ok: false,
      mylistId,
      errorMessage: "Service Workerから応答がありません。",
    };
  } catch (e) {
    return {
      ok: false,
      mylistId,
      errorMessage:
        e instanceof Error
          ? `Service Worker通信失敗: ${e.message}`
          : "Service Worker通信失敗",
    };
  }
}

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

export type MylistImportProgress = {
  total: number;
  done: number;
  imported: number;
  duplicated: number;
  failed: number;
  running: boolean;
  mylistId?: string;
  lastError?: string;
};

type AddVideoFn = (
  tab: NicoPongTab,
  draft: NicoPongVideoDraft
) => Promise<NicoPongVideo>;

export function useMylistImport(addVideo: AddVideoFn) {
  const [progress, setProgress] = useState<MylistImportProgress>({
    total: 0,
    done: 0,
    imported: 0,
    duplicated: 0,
    failed: 0,
    running: false,
  });

  const importMylist = useCallback(
    async (
      mylistId: string,
      target: ImportTarget
    ): Promise<MylistImportResult> => {
      setProgress({
        total: 0,
        done: 0,
        imported: 0,
        duplicated: 0,
        failed: 0,
        running: true,
        mylistId,
      });

      const fetchRes = await requestMylistVideoIds(mylistId, target);
      if (!fetchRes.ok) {
        setProgress((p) => ({
          ...p,
          running: false,
          lastError: fetchRes.errorMessage,
        }));
        return {
          ok: false,
          mylistId,
          total: 0,
          imported: 0,
          duplicated: 0,
          failed: 0,
          videoIds: [],
          errorMessage: fetchRes.errorMessage,
        };
      }

      const videoIds = fetchRes.videoIds;
      setProgress({
        total: videoIds.length,
        done: 0,
        imported: 0,
        duplicated: 0,
        failed: 0,
        running: true,
        mylistId,
      });

      let imported = 0;
      let duplicated = 0;
      let failed = 0;

      for (const videoId of videoIds) {
        try {
          const info = await fetchNicoVideoInfo(videoId);
          if (!info.ok) {
            failed += 1;
            setProgress((p) => ({
              ...p,
              done: p.done + 1,
              failed,
              lastError: `${videoId}: ${info.errorMessage}`,
            }));
            continue;
          }

          // 引用可否チェック (失敗してもimportは継続)
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
              info.video.noLivePlay || quotable === false ? true : info.video.noLivePlay,
            sourceType: "mylist",
            sourceMylistId: mylistId,
            status:
              quotable === false ? "no_live_play" : info.video.status,
            ngReason:
              quotable === false
                ? info.video.ngReason ?? "引用不可動画"
                : info.video.ngReason,
          };

          try {
            await addVideo(target, draft);
            imported += 1;
          } catch (err) {
            if (err instanceof Error && err.message === "DUPLICATE_VIDEO") {
              duplicated += 1;
            } else {
              failed += 1;
              setProgress((p) => ({
                ...p,
                lastError:
                  err instanceof Error
                    ? `${videoId}: ${err.message}`
                    : `${videoId}: 保存失敗`,
              }));
            }
          }
          setProgress((p) => ({
            ...p,
            done: p.done + 1,
            imported,
            duplicated,
            failed,
          }));
        } catch (e) {
          failed += 1;
          setProgress((p) => ({
            ...p,
            done: p.done + 1,
            failed,
            lastError:
              e instanceof Error
                ? `${videoId}: ${e.message}`
                : `${videoId}: 例外`,
          }));
        }
      }

      setProgress((p) => ({ ...p, running: false }));

      return {
        ok: true,
        mylistId,
        total: videoIds.length,
        imported,
        duplicated,
        failed,
        videoIds,
      };
    },
    [addVideo]
  );

  return { progress, importMylist };
}
