import { STORE_VIDEOS } from "../shared/constants";
import type {
  NicoPongTab,
  NicoPongVideo,
  NicoPongVideoDraft,
  VideoItemStatus,
  VideoSourceType,
} from "../shared/types";
import { reqToPromise, runTx } from "./db";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listVideos(tab: NicoPongTab): Promise<NicoPongVideo[]> {
  return runTx(STORE_VIDEOS, "readonly", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const index = store.index("addedTo");
    const range = IDBKeyRange.only(tab);
    const all = await reqToPromise(index.getAll(range));
    return (all as NicoPongVideo[]).sort((a, b) => a.order - b.order);
  });
}

export async function findByVideoId(
  tab: NicoPongTab,
  videoId: string
): Promise<NicoPongVideo | null> {
  const items = await listVideos(tab);
  return items.find((v) => v.videoId === videoId) ?? null;
}

export async function addVideo(
  tab: NicoPongTab,
  draft: NicoPongVideoDraft,
  options: { allowDuplicate?: boolean } = {}
): Promise<NicoPongVideo> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const index = store.index("addedTo");
    const range = IDBKeyRange.only(tab);
    const existing = (await reqToPromise(index.getAll(range))) as NicoPongVideo[];

    if (!options.allowDuplicate) {
      const dup = existing.find((v) => v.videoId === draft.videoId);
      if (dup) {
        throw new Error("DUPLICATE_VIDEO");
      }
    }

    const maxOrder = existing.reduce((m, v) => Math.max(m, v.order), -1);
    const now = new Date().toISOString();
    const record: NicoPongVideo = {
      ...draft,
      id: newId(),
      addedTo: tab,
      order: maxOrder + 1,
      addedAt: now,
      updatedAt: now,
      status: draft.status ?? "queued",
    };
    await reqToPromise(store.add(record));
    return record;
  });
}

export async function updateVideo(video: NicoPongVideo): Promise<void> {
  await runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const updated: NicoPongVideo = {
      ...video,
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
  });
}

export async function deleteVideo(id: string): Promise<void> {
  await runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    await reqToPromise(store.delete(id));
  });
}

export async function reorderVideos(
  tab: NicoPongTab,
  idsInOrder: string[]
): Promise<void> {
  await runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const index = store.index("addedTo");
    const range = IDBKeyRange.only(tab);
    const existing = (await reqToPromise(index.getAll(range))) as NicoPongVideo[];
    const byId = new Map(existing.map((v) => [v.id, v]));
    const now = new Date().toISOString();

    for (let i = 0; i < idsInOrder.length; i++) {
      const id = idsInOrder[i];
      const v = byId.get(id);
      if (!v) continue;
      const next: NicoPongVideo = { ...v, order: i, updatedAt: now };
      await reqToPromise(store.put(next));
    }
  });
}

export async function updateVideoStatus(
  id: string,
  status: VideoItemStatus
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function markVideoPlayed(
  id: string,
  playedAt: string
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      status: "played",
      lastPlayedAt: playedAt,
      playCount: (existing.playCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function markVideoUnplayable(
  id: string,
  reason?: string
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      noLivePlay: true,
      quotable: false,
      status: "no_live_play",
      ngReason: reason ?? existing.ngReason ?? "引用再生できない可能性があります",
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function markVideoNg(
  id: string,
  reason: string
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      status: "ng",
      ngReason: reason,
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function setVideoQuotable(
  id: string,
  quotable: boolean
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      quotable,
      updatedAt: new Date().toISOString(),
      ...(quotable
        ? {}
        : {
            status:
              existing.status === "playing" ? existing.status : "no_live_play",
            ngReason: existing.ngReason ?? "引用不可動画",
          }),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

export async function incrementPlayCount(
  id: string
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    const updated: NicoPongVideo = {
      ...existing,
      playCount: (existing.playCount ?? 0) + 1,
      lastPlayedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await reqToPromise(store.put(updated));
    return updated;
  });
}

// ストック → リクエスト等のタブ間移動 (idは新規発行、orderは末尾)。
export async function moveVideoToTab(
  id: string,
  targetTab: NicoPongTab,
  sourceType?: VideoSourceType,
  options: { allowDuplicate?: boolean } = {}
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;
    if (existing.addedTo === targetTab) return existing;

    const index = store.index("addedTo");
    const targetExisting = (await reqToPromise(
      index.getAll(IDBKeyRange.only(targetTab))
    )) as NicoPongVideo[];

    if (!options.allowDuplicate) {
      const dup = targetExisting.find((v) => v.videoId === existing.videoId);
      if (dup) throw new Error("DUPLICATE_VIDEO");
    }
    const maxOrder = targetExisting.reduce((m, v) => Math.max(m, v.order), -1);
    const now = new Date().toISOString();

    // 既存レコードを削除 → 新規IDで追加 (実装単純化)
    await reqToPromise(store.delete(existing.id));
    const moved: NicoPongVideo = {
      ...existing,
      id: newId(),
      addedTo: targetTab,
      order: maxOrder + 1,
      addedAt: now,
      updatedAt: now,
      status: "queued",
      sourceType: sourceType ?? existing.sourceType,
    };
    await reqToPromise(store.add(moved));
    return moved;
  });
}

// ストック → リクエスト等のコピー (元は残す)。
export async function copyVideoToTab(
  id: string,
  targetTab: NicoPongTab,
  sourceType?: VideoSourceType,
  options: { allowDuplicate?: boolean } = {}
): Promise<NicoPongVideo | null> {
  return runTx(STORE_VIDEOS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_VIDEOS);
    const existing = (await reqToPromise(store.get(id))) as
      | NicoPongVideo
      | undefined;
    if (!existing) return null;

    const index = store.index("addedTo");
    const targetExisting = (await reqToPromise(
      index.getAll(IDBKeyRange.only(targetTab))
    )) as NicoPongVideo[];

    if (!options.allowDuplicate) {
      const dup = targetExisting.find((v) => v.videoId === existing.videoId);
      if (dup) throw new Error("DUPLICATE_VIDEO");
    }
    const maxOrder = targetExisting.reduce((m, v) => Math.max(m, v.order), -1);
    const now = new Date().toISOString();

    const copied: NicoPongVideo = {
      ...existing,
      id: newId(),
      addedTo: targetTab,
      order: maxOrder + 1,
      addedAt: now,
      updatedAt: now,
      status: "queued",
      sourceType: sourceType ?? "stock_copy",
      lastPlayedAt: undefined,
      playCount: undefined,
    };
    await reqToPromise(store.add(copied));
    return copied;
  });
}
