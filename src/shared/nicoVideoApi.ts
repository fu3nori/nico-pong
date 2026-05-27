import { inferDisplayAuthorName } from "./authorName";
import { buildNicoVideoUrl } from "./nicoVideoId";
import {
  bool01Of,
  intOf,
  parseNicoLengthToSeconds,
  textOf,
} from "./nicoThumbInfo";
import type { NicoPongVideoDraft, VideoFetchResult } from "./types";

// ニコニコ動画情報取得はここに隔離する。
// 他レイヤから直接 fetch しないこと。仕様変更時はこのファイルだけ差し替える。

const THUMB_INFO_ENDPOINT = "https://ext.nicovideo.jp/api/getthumbinfo";

// 開発用モック切り替え。本番ビルドでは false 推奨。
const USE_MOCK_VIDEO_API =
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_USE_MOCK_VIDEO_API === "true";

function mockNicoVideoDraft(videoId: string): NicoPongVideoDraft {
  const tags = ["サンプル"];
  const ownerName = `投稿者(${videoId})`;
  const author = inferDisplayAuthorName({ ownerName, tags });
  return {
    videoId,
    url: buildNicoVideoUrl(videoId),
    title: `動画 ${videoId} (MOCK)`,
    thumbnailUrl: undefined,
    ownerName,
    ownerId: undefined,
    displayAuthorName: author.name,
    authorNameSource: author.source,
    viewCount: undefined,
    commentCount: undefined,
    mylistCount: undefined,
    likeCount: undefined,
    durationSec: undefined,
    tags,
    lockedTags: [],
    memo: undefined,
    lastFetchedAt: new Date().toISOString(),
    fetchSource: "mock",
  };
}

function thumbErrorMessage(code: string | undefined, description: string | undefined): string {
  const codeLabel =
    code === "NOT_FOUND"
      ? "動画が存在しません"
      : code === "DELETED"
      ? "削除済みの動画です"
      : code === "COMMUNITY"
      ? "コミュニティ限定動画のため取得できません"
      : code ?? "UNKNOWN";
  return description
    ? `動画情報を取得できません: ${codeLabel} (${description})`
    : `動画情報を取得できません: ${codeLabel}`;
}

async function fetchThumbInfo(videoId: string): Promise<VideoFetchResult> {
  let res: Response;
  try {
    res = await fetch(`${THUMB_INFO_ENDPOINT}/${encodeURIComponent(videoId)}`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
  } catch (e) {
    return {
      ok: false,
      videoId,
      errorMessage:
        e instanceof Error
          ? `ネットワークエラー: ${e.message}`
          : "ネットワークエラー",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      videoId,
      errorMessage: `動画情報取得失敗: HTTP ${res.status}`,
    };
  }

  const xmlText = await res.text();
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return {
      ok: false,
      videoId,
      errorMessage: "動画情報のXMLパースに失敗しました",
    };
  }

  const status = doc.documentElement.getAttribute("status");
  if (status !== "ok") {
    const code = textOf(doc, "error > code");
    const description = textOf(doc, "error > description");
    return {
      ok: false,
      videoId,
      errorMessage: thumbErrorMessage(code, description),
    };
  }

  const thumb = doc.querySelector("thumb");
  if (!thumb) {
    return {
      ok: false,
      videoId,
      errorMessage: "動画情報の本文が見つかりません (thumb要素なし)",
    };
  }

  const title = textOf(thumb, "title") ?? `動画 ${videoId}`;
  const thumbnailUrl = textOf(thumb, "thumbnail_url");
  const durationSec = parseNicoLengthToSeconds(textOf(thumb, "length"));
  const viewCount = intOf(thumb, "view_counter");
  const commentCount = intOf(thumb, "comment_num");
  const mylistCount = intOf(thumb, "mylist_counter");
  const watchUrl = textOf(thumb, "watch_url") ?? buildNicoVideoUrl(videoId);
  const noLivePlay = bool01Of(thumb, "no_live_play");

  const embeddableInt = intOf(thumb, "embeddable");
  const embeddable =
    embeddableInt === undefined ? undefined : embeddableInt === 1;

  // user_id/user_nickname と ch_id/ch_name のどちらかが入る
  const userId = textOf(thumb, "user_id");
  const userNickname = textOf(thumb, "user_nickname");
  const chId = textOf(thumb, "ch_id");
  const chName = textOf(thumb, "ch_name");

  const ownerId = chId ?? userId;
  const ownerName = chName ?? userNickname;

  const tagNodes = Array.from(thumb.querySelectorAll("tags > tag"));
  const tags = tagNodes
    .map((node) => node.textContent?.trim())
    .filter((v): v is string => !!v);
  const lockedTags = tagNodes
    .filter((node) => node.getAttribute("lock") === "1")
    .map((node) => node.textContent?.trim())
    .filter((v): v is string => !!v);

  const author = inferDisplayAuthorName({
    ownerName,
    tags,
    lockedTags,
  });

  const draft: NicoPongVideoDraft = {
    videoId,
    url: watchUrl,
    title,
    thumbnailUrl,
    ownerId,
    ownerName,
    displayAuthorName: author.name,
    authorNameSource: author.source,
    viewCount,
    commentCount,
    mylistCount,
    likeCount: undefined,
    durationSec,
    tags,
    lockedTags,
    memo: undefined,
    lastFetchedAt: new Date().toISOString(),
    noLivePlay,
    embeddable,
    fetchSource: "getthumbinfo",
  };

  return { ok: true, video: draft };
}

export async function fetchNicoVideoInfo(
  videoId: string
): Promise<VideoFetchResult> {
  if (USE_MOCK_VIDEO_API) {
    return { ok: true, video: mockNicoVideoDraft(videoId) };
  }
  return fetchThumbInfo(videoId);
}
