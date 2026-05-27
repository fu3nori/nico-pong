import type { PlaybackState } from "../../shared/types";

type Props = {
  state: PlaybackState;
  onStop: () => void;
  onSkip: () => void;
  onMarkPlayed: () => void;
  onPostBroadcasterComment: () => void;
  canPostComment: boolean;
};

function statusLabel(status: PlaybackState["status"]): string {
  switch (status) {
    case "playing":
      return "再生中";
    case "loading":
      return "再生準備中";
    case "ended":
      return "終了";
    case "interrupted":
      return "中断";
    case "error":
      return "エラー";
    case "idle":
    default:
      return "なし";
  }
}

function sourceLabel(source: PlaybackState["source"]): string {
  switch (source) {
    case "request":
      return "リクエスト";
    case "stock":
      return "ストック";
    case "manual_input":
      return "手動";
    default:
      return "-";
  }
}

export default function NowPlayingPanel({
  state,
  onStop,
  onSkip,
  onMarkPlayed,
  onPostBroadcasterComment,
  canPostComment,
}: Props) {
  const hasCurrent = state.status !== "idle" && !!state.currentVideoId;

  return (
    <section className="now-playing" aria-label="現在再生中">
      <div className="now-playing-header">
        <span className="label">現在再生中:</span>
        <span className={`status-badge playback-${state.status}`}>
          {statusLabel(state.status)}
        </span>
      </div>
      {hasCurrent ? (
        <div className="now-playing-body">
          <div className="thumb">
            {state.currentThumbnailUrl ? (
              <img src={state.currentThumbnailUrl} alt="" />
            ) : (
              <span>No Thumb</span>
            )}
          </div>
          <div className="info">
            <div className="title" title={state.currentTitle ?? ""}>
              {state.currentTitle ?? state.currentVideoId}
            </div>
            <div className="meta-row">
              <span>ID: {state.currentVideoId}</span>
              <span>ソース: {sourceLabel(state.source)}</span>
            </div>
            {state.errorMessage ? (
              <div className="error">{state.errorMessage}</div>
            ) : null}
            <div className="actions">
              <button type="button" onClick={onStop}>
                停止
              </button>
              <button type="button" onClick={onSkip}>
                次へ
              </button>
              <button type="button" onClick={onMarkPlayed}>
                再生済み
              </button>
              <button
                type="button"
                onClick={onPostBroadcasterComment}
                disabled={!canPostComment}
                title={
                  canPostComment
                    ? "動画情報を主コメ投稿"
                    : "再生中の動画情報がないため投稿できません"
                }
              >
                動画情報を主コメ投稿
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="now-playing-empty">なし</div>
      )}
    </section>
  );
}
