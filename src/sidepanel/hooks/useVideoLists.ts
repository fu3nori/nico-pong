import { useCallback, useEffect, useState } from "react";
import type {
  NicoPongTab,
  NicoPongVideo,
  NicoPongVideoDraft,
  VideoItemStatus,
  VideoSourceType,
} from "../../shared/types";
import {
  addVideo as repoAddVideo,
  copyVideoToTab as repoCopyVideoToTab,
  deleteVideo as repoDeleteVideo,
  findByVideoId as repoFindByVideoId,
  listVideos,
  markVideoNg as repoMarkVideoNg,
  markVideoPlayed as repoMarkVideoPlayed,
  markVideoUnplayable as repoMarkVideoUnplayable,
  moveVideoToTab as repoMoveVideoToTab,
  reorderVideos as repoReorderVideos,
  setVideoQuotable as repoSetVideoQuotable,
  updateVideo as repoUpdateVideo,
  updateVideoStatus as repoUpdateVideoStatus,
} from "../../storage/videoRepository";

type Lists = Record<NicoPongTab, NicoPongVideo[]>;

type AddOptions = {
  allowDuplicate?: boolean;
};

export function useVideoLists() {
  const [lists, setLists] = useState<Lists>({ request: [], stock: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [req, stk] = await Promise.all([
        listVideos("request"),
        listVideos("stock"),
      ]);
      setLists({ request: req, stock: stk });
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? `データ読み込みに失敗: ${e.message}`
          : "データ読み込みに失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addVideo = useCallback(
    async (
      tab: NicoPongTab,
      draft: NicoPongVideoDraft,
      options: AddOptions = {}
    ): Promise<NicoPongVideo> => {
      const created = await repoAddVideo(tab, draft, options);
      setLists((prev) => ({
        ...prev,
        [tab]: [...prev[tab], created].sort((a, b) => a.order - b.order),
      }));
      return created;
    },
    []
  );

  const deleteVideo = useCallback(
    async (tab: NicoPongTab, id: string) => {
      await repoDeleteVideo(id);
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].filter((v) => v.id !== id),
      }));
    },
    []
  );

  const updateVideo = useCallback(
    async (tab: NicoPongTab, video: NicoPongVideo) => {
      await repoUpdateVideo(video);
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === video.id ? { ...video } : v)),
      }));
    },
    []
  );

  const reorderVideos = useCallback(
    async (tab: NicoPongTab, idsInOrder: string[]) => {
      setLists((prev) => {
        const byId = new Map(prev[tab].map((v) => [v.id, v]));
        const next = idsInOrder
          .map((id, i) => {
            const v = byId.get(id);
            return v ? { ...v, order: i } : null;
          })
          .filter((v): v is NicoPongVideo => v !== null);
        return { ...prev, [tab]: next };
      });
      await repoReorderVideos(tab, idsInOrder);
    },
    []
  );

  const updateVideoStatus = useCallback(
    async (tab: NicoPongTab, id: string, status: VideoItemStatus) => {
      const updated = await repoUpdateVideoStatus(id, status);
      if (!updated) return;
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
      }));
    },
    []
  );

  const markPlayed = useCallback(
    async (tab: NicoPongTab, id: string) => {
      const updated = await repoMarkVideoPlayed(id, new Date().toISOString());
      if (!updated) return;
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
      }));
    },
    []
  );

  const markUnplayable = useCallback(
    async (tab: NicoPongTab, id: string, reason?: string) => {
      const updated = await repoMarkVideoUnplayable(id, reason);
      if (!updated) return;
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
      }));
    },
    []
  );

  const markNg = useCallback(
    async (tab: NicoPongTab, id: string, reason: string) => {
      const updated = await repoMarkVideoNg(id, reason);
      if (!updated) return;
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
      }));
    },
    []
  );

  const setQuotable = useCallback(
    async (tab: NicoPongTab, id: string, quotable: boolean) => {
      const updated = await repoSetVideoQuotable(id, quotable);
      if (!updated) return;
      setLists((prev) => ({
        ...prev,
        [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
      }));
    },
    []
  );

  const moveToTab = useCallback(
    async (
      fromTab: NicoPongTab,
      id: string,
      toTab: NicoPongTab,
      sourceType?: VideoSourceType,
      options: { allowDuplicate?: boolean } = {}
    ) => {
      const moved = await repoMoveVideoToTab(id, toTab, sourceType, options);
      if (!moved) return null;
      setLists((prev) => ({
        ...prev,
        [fromTab]: prev[fromTab].filter((v) => v.id !== id),
        [toTab]: [...prev[toTab], moved].sort((a, b) => a.order - b.order),
      }));
      return moved;
    },
    []
  );

  const copyToTab = useCallback(
    async (
      id: string,
      toTab: NicoPongTab,
      sourceType?: VideoSourceType,
      options: { allowDuplicate?: boolean } = {}
    ) => {
      const copied = await repoCopyVideoToTab(id, toTab, sourceType, options);
      if (!copied) return null;
      setLists((prev) => ({
        ...prev,
        [toTab]: [...prev[toTab], copied].sort((a, b) => a.order - b.order),
      }));
      return copied;
    },
    []
  );

  const findByVideoId = useCallback(
    async (tab: NicoPongTab, videoId: string) => {
      return repoFindByVideoId(tab, videoId);
    },
    []
  );

  return {
    lists,
    loading,
    error,
    refresh,
    addVideo,
    deleteVideo,
    updateVideo,
    reorderVideos,
    updateVideoStatus,
    markPlayed,
    markUnplayable,
    markNg,
    setQuotable,
    moveToTab,
    copyToTab,
    findByVideoId,
  };
}
