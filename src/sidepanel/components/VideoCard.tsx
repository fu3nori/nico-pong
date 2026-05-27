import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NicoPongTab, NicoPongVideo } from "../../shared/types";
import { formatCount, formatDuration } from "../../shared/format";
import { inferDisplayAuthorName } from "../../shared/authorName";

type Props = {
  tab: NicoPongTab;
  video: NicoPongVideo;
  isCurrent: boolean;
  onDelete: (id: string) => void;
  onUpdate: (video: NicoPongVideo) => void;
  onForcePlay: (video: NicoPongVideo) => void;
  onCopyToRequest?: (video: NicoPongVideo) => void;
  onMoveToRequest?: (video: NicoPongVideo) => void;
};

function statusBadge(status: NicoPongVideo["status"]): string {
  switch (status) {
    case "playing":
      return "再生中";
    case "played":
      return "再生済";
    case "interrupted":
      return "中断";
    case "skipped":
      return "スキップ";
    case "error":
      return "エラー";
    case "ng":
      return "NG";
    case "no_live_play":
      return "引用不可";
    case "checking":
      return "確認中";
    case "ready":
      return "準備完了";
    case "queued":
    default:
      return "待機";
  }
}

export default function VideoCard({
  tab,
  video,
  isCurrent,
  onDelete,
  onUpdate,
  onForcePlay,
  onCopyToRequest,
  onMoveToRequest,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [editing, setEditing] = useState(false);
  const [draftAuthor, setDraftAuthor] = useState(
    video.displayAuthorName ?? ""
  );

  const author = video.displayAuthorName ?? video.ownerName ?? "-";
  const requesterLabel = video.requestUserName
    ? `@${video.requestUserName}`
    : video.requestUserId
    ? `id:${video.requestUserId}`
    : null;

  function saveAuthor() {
    const name = draftAuthor.trim();
    if (!name) {
      const re = inferDisplayAuthorName({
        ownerName: video.ownerName,
        tags: video.tags,
        lockedTags: video.lockedTags,
      });
      onUpdate({
        ...video,
        displayAuthorName: re.name,
        authorNameSource: re.source,
      });
    } else {
      onUpdate({
        ...video,
        displayAuthorName: name,
        authorNameSource: "manual",
      });
    }
    setEditing(false);
  }

  function handleCardClick() {
    if (editing) return;
    handleForcePlay();
  }

  function handleForcePlay() {
    if (
      video.noLivePlay ||
      video.quotable === false ||
      video.status === "no_live_play" ||
      video.status === "ng"
    ) {
      const reason = video.ngReason ?? "引用不可の可能性があります";
      const ok = confirm(`${reason}\n続行しますか?`);
      if (!ok) return;
    }
    onForcePlay(video);
  }

  const cardClass = [
    "video-card",
    isDragging ? "dragging" : "",
    isCurrent ? "current" : "",
    video.status ? `status-${video.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const showStockMoveButtons = tab === "stock";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cardClass}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleForcePlay();
        }
      }}
      aria-label={`${video.title} をクリックで再生`}
    >
      <div className="thumb">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" />
        ) : (
          <span>No Thumb</span>
        )}
      </div>
      <div className="body">
        <div className="title" title={video.title}>
          {video.title}
        </div>
        <div className="author" onClick={(e) => e.stopPropagation()}>
          作者:
          {editing ? (
            <span className="author-edit">
              <input
                type="text"
                value={draftAuthor}
                onChange={(e) => setDraftAuthor(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  saveAuthor();
                }}
              >
                保存
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftAuthor(video.displayAuthorName ?? "");
                  setEditing(false);
                }}
              >
                取消
              </button>
            </span>
          ) : (
            <>
              <span>{author}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftAuthor(video.displayAuthorName ?? "");
                  setEditing(true);
                }}
              >
                編集
              </button>
            </>
          )}
        </div>
        {requesterLabel ? (
          <div className="requester">
            リク主: {requesterLabel}
            {video.requestCommentNo
              ? ` / C#${video.requestCommentNo}`
              : ""}
          </div>
        ) : null}
        <div className="row">
          <span className="id">{video.videoId}</span>
          <span>時間: {formatDuration(video.durationSec)}</span>
          <span className={`status-badge item-${video.status ?? "queued"}`}>
            {statusBadge(video.status)}
          </span>
        </div>
        <div className="row">
          <span>再生: {formatCount(video.viewCount)}</span>
          <span>コメ: {formatCount(video.commentCount)}</span>
          <span>マイ: {formatCount(video.mylistCount)}</span>
          <span>
            いいね:{" "}
            {video.likeCount === undefined ? "-" : formatCount(video.likeCount)}
          </span>
        </div>
        {video.noLivePlay || video.quotable === false ? (
          <div className="warn-row">
            <span className="badge-unplayable">引用不可</span>
            {video.ngReason ? ` ${video.ngReason}` : ""}
            {tab === "request" ? " 自動再生から除外されます" : ""}
          </div>
        ) : null}
        {video.status === "ng" && video.ngReason ? (
          <div className="warn-row">
            <span className="badge-ng">NG</span> {video.ngReason}
          </div>
        ) : null}
        {video.tags.length > 0 ? (
          <div className="tags" title={video.tags.join(", ")}>
            タグ: {video.tags.join(", ")}
          </div>
        ) : null}
        <div
          className="actions"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span
            className="drag-handle"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label="ドラッグして並び替え"
            title="ドラッグして並び替え"
          >
            ⋮⋮
          </span>
          <button
            type="button"
            className="primary"
            onClick={(e) => {
              e.stopPropagation();
              handleForcePlay();
            }}
            title="今すぐ再生"
          >
            今すぐ再生
          </button>
          {showStockMoveButtons && onCopyToRequest ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopyToRequest(video);
              }}
              title="リクエストへコピー (ストックには残す)"
            >
              リクへコピー
            </button>
          ) : null}
          {showStockMoveButtons && onMoveToRequest ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveToRequest(video);
              }}
              title="リクエストへ移動 (ストックから消す)"
            >
              リクへ移動
            </button>
          ) : null}
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{ fontSize: 11 }}
            onClick={(e) => e.stopPropagation()}
          >
            開く
          </a>
          <button
            type="button"
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`「${video.title}」を削除しますか?`)) {
                onDelete(video.id);
              }
            }}
          >
            削除
          </button>
        </div>
      </div>
    </div>
  );
}
