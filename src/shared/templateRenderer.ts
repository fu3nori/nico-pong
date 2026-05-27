import { inferDisplayAuthorName } from "./authorName";
import { formatDuration } from "./format";
import type { NicoPongVideo } from "./types";

// {variable} 形式のテンプレ展開。
// 未定義値は安全にフォールバックする ({author}/{displayAuthorName} は最終フォールバックで "不明")。

const VARIABLE_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

// 動画から「最終的な作者表示名」を導出する。
// 1. video.displayAuthorName があればそれ
// 2. なければタグから再推定
// 3. それでもなければ ownerName
// 4. 最後は "不明"
export function resolveAuthorDisplayName(video: NicoPongVideo): string {
  const explicit = video.displayAuthorName?.trim();
  if (explicit) return explicit;
  const inferred = inferDisplayAuthorName({
    ownerName: video.ownerName,
    tags: video.tags,
    lockedTags: video.lockedTags,
  });
  if (inferred.name && inferred.name.trim().length > 0) {
    return inferred.name.trim();
  }
  const owner = video.ownerName?.trim();
  if (owner) return owner;
  return "不明";
}

function variableValue(video: NicoPongVideo, name: string): string {
  switch (name) {
    case "videoId":
    case "id":
      return video.videoId;
    case "url":
      return video.url;
    case "title":
      return video.title;
    case "ownerName":
      return video.ownerName ?? "";
    case "author":
    case "displayAuthorName":
      return resolveAuthorDisplayName(video);
    case "viewCount":
      return video.viewCount?.toString() ?? "-";
    case "commentCount":
      return video.commentCount?.toString() ?? "-";
    case "mylistCount":
      return video.mylistCount?.toString() ?? "-";
    case "likeCount":
      return video.likeCount?.toString() ?? "-";
    case "duration":
      return formatDuration(video.durationSec);
    case "requestUserName":
      return video.requestUserName ?? "";
    case "requestCommentNo":
      return video.requestCommentNo?.toString() ?? "";
    case "tags":
      return video.tags.join(",");
    default:
      return "";
  }
}

export function renderBroadcasterCommentTemplate(
  template: string,
  video: NicoPongVideo
): string {
  return template.replace(VARIABLE_PATTERN, (_, name: string) =>
    variableValue(video, name)
  );
}
