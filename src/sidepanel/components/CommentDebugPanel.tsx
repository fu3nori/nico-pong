// コメント受信→動画ID抽出→動画情報取得→リクエスト登録 の障害切り分け用パネル。
// docs/nico-pong_comment_debug_instruction.md
// docs/nico-pong_nicolive_comment_debug_plan.md

import { useState } from "react";
import type {
  CommentDebugFetchStatus,
  CommentDebugParseStatus,
  CommentDebugRequestStatus,
  CommentDebugState,
  CommentDebugWatcherStatus,
  NicoPongDebugEvent,
  WatchWsState,
} from "../../shared/types";

type Props = {
  state: CommentDebugState;
  onReset?: () => void;
};

function watcherLabel(s: CommentDebugWatcherStatus): string {
  switch (s) {
    case "watching":
      return "監視中";
    case "error":
      return "エラー";
    case "idle":
    default:
      return "未接続";
  }
}
function parseLabel(s: CommentDebugParseStatus): string {
  switch (s) {
    case "success":
      return "成功";
    case "failed":
      return "失敗";
    case "not_checked":
    default:
      return "未判定";
  }
}
function fetchLabel(s: CommentDebugFetchStatus): string {
  switch (s) {
    case "fetching":
      return "実行中";
    case "success":
      return "成功";
    case "failed":
      return "失敗";
    case "not_started":
    default:
      return "未実行";
  }
}
function requestLabel(s: CommentDebugRequestStatus): string {
  switch (s) {
    case "success":
      return "成功";
    case "failed":
      return "失敗";
    case "not_started":
    default:
      return "未実行";
  }
}
function wsLabel(s: WatchWsState): string {
  switch (s) {
    case "open":
      return "接続済";
    case "connecting":
      return "接続中";
    case "closed":
      return "切断";
    case "error":
      return "エラー";
    case "not_tried":
    default:
      return "未試行";
  }
}
function boolLabel(b: boolean | undefined): string {
  if (b === true) return "✅ YES";
  if (b === false) return "❌ NO";
  return "-";
}
function formatTime(iso: string | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}
function formatTimestamp(ts: number): string {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return "-";
  }
}

function EventLog({ events }: { events: NicoPongDebugEvent[] }) {
  // 新しい順
  const reversed = [...events].reverse();
  if (reversed.length === 0) {
    return <div className="cd-event-log-empty">(イベント無し)</div>;
  }
  return (
    <ul className="cd-event-log">
      {reversed.map((ev, i) => (
        <li
          key={`${ev.timestamp}-${i}`}
          className={`cd-event ${ev.ok ? "cd-event-ok" : "cd-event-ng"}`}
        >
          <span className="cd-event-time">{formatTimestamp(ev.timestamp)}</span>
          <span className="cd-event-stage">{ev.stage}</span>
          <span className="cd-event-msg" title={ev.message}>
            {ev.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function CommentDebugPanel({ state, onReset }: Props) {
  const [open, setOpen] = useState(true);
  const [showLog, setShowLog] = useState(false);

  return (
    <section className="comment-debug">
      <div className="comment-debug-header">
        <button
          type="button"
          className="comment-debug-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          コメント受信デバッグ {open ? "▲" : "▼"}
        </button>
        <button
          type="button"
          className="comment-debug-reset"
          onClick={() => setShowLog((v) => !v)}
        >
          {showLog ? "ログ非表示" : `イベントログ表示 (${state.events.length})`}
        </button>
        {onReset ? (
          <button
            type="button"
            className="comment-debug-reset"
            onClick={onReset}
            title="デバッグ表示をリセット"
          >
            リセット
          </button>
        ) : null}
      </div>
      {open ? (
        <>
          <h4 className="cd-section-title">📡 接続前: embedded-data introspection</h4>
          <dl className="comment-debug-list">
            <dt>番組ID (URLから)</dt>
            <dd className="cd-mono">{state.programIdFromUrl ?? "-"}</dd>
            <dt>#embedded-data 要素</dt>
            <dd>{boolLabel(state.embeddedDataFound)}</dd>
            <dt>data-props 属性</dt>
            <dd>{boolLabel(state.dataPropsFound)}</dd>
            <dt>JSON parse</dt>
            <dd>{boolLabel(state.dataPropsParsed)}</dd>
            <dt>parse エラー</dt>
            <dd className="cd-error">{state.dataPropsParseError ?? "-"}</dd>
            <dt>root keys</dt>
            <dd className="cd-mono">
              {state.rootKeys.length > 0 ? `[${state.rootKeys.join(", ")}]` : "-"}
            </dd>
            <dt>webSocketUrl 候補数</dt>
            <dd>{state.webSocketUrlCandidates.length}</dd>
            <dt>採用 webSocketUrl</dt>
            <dd className="cd-mono cd-comment-text" title={state.selectedWebSocketUrl}>
              {state.selectedWebSocketUrl ?? "-"}
            </dd>
          </dl>
          {state.webSocketUrlCandidates.length > 0 ? (
            <details className="cd-candidates">
              <summary>WebSocket URL 候補一覧</summary>
              <ul>
                {state.webSocketUrlCandidates.map((c, i) => (
                  <li key={i}>
                    <span className="cd-mono">{c.path}</span>:{" "}
                    <span className="cd-mono cd-comment-text" title={c.value}>
                      {c.value}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <h4 className="cd-section-title">📞 watch WebSocket ライフサイクル</h4>
          <dl className="comment-debug-list">
            <dt>WebSocket 状態</dt>
            <dd className={`watcher-${state.watchWsState === "open" ? "watching" : state.watchWsState === "error" ? "error" : "idle"}`}>
              {wsLabel(state.watchWsState)}
            </dd>
            <dt>startWatching 送信回数</dt>
            <dd>{state.startWatchingSentCount}</dd>
            <dt>seat 受信回数</dt>
            <dd>{state.seatReceivedCount}</dd>
            <dt>keepSeat 送信回数</dt>
            <dd>{state.keepSeatSentCount}</dd>
            <dt>ping 受信回数</dt>
            <dd>{state.pingReceivedCount}</dd>
            <dt>pong 送信回数</dt>
            <dd>{state.pongSentCount}</dd>
          </dl>

          <h4 className="cd-section-title">🎯 messageServer / viewUri / NDGR</h4>
          <dl className="comment-debug-list">
            <dt>messageServer 受信回数</dt>
            <dd>{state.messageServerReceivedCount}</dd>
            <dt>最後の viewUri</dt>
            <dd className="cd-mono cd-comment-text" title={state.lastViewUri}>
              {state.lastViewUri ?? "-"}
            </dd>
            <dt>message stream open 回数</dt>
            <dd>{state.messageStreamOpenCount}</dd>
            <dt>protobuf decode 成功回数</dt>
            <dd>{state.decodeOkCount}</dd>
            <dt>protobuf decode 失敗回数</dt>
            <dd className={state.decodeFailCount > 0 ? "cd-error" : ""}>
              {state.decodeFailCount}
            </dd>
          </dl>

          <h4 className="cd-section-title">🔬 直近 NDGR fetch 詳細</h4>
          <dl className="comment-debug-list">
            <dt>label</dt>
            <dd>{state.lastStreamLabel ?? "-"}</dd>
            <dt>?at= 渡し値</dt>
            <dd className="cd-mono">{state.lastStreamAtParam ?? "-"}</dd>
            <dt>HTTP status</dt>
            <dd
              className={
                state.lastStreamHttpStatus !== undefined &&
                state.lastStreamHttpStatus >= 400
                  ? "cd-error"
                  : ""
              }
            >
              {state.lastStreamHttpStatus ?? "-"}
            </dd>
            <dt>Content-Type</dt>
            <dd className="cd-mono">{state.lastStreamContentType ?? "-"}</dd>
            <dt>受信総バイト数</dt>
            <dd
              className={
                state.lastStreamTotalBytes !== undefined &&
                state.lastStreamTotalBytes === 0
                  ? "cd-error"
                  : ""
              }
            >
              {state.lastStreamTotalBytes ?? "-"}
            </dd>
            <dt>応答時間 (ms)</dt>
            <dd>{state.lastStreamDurationMs ?? "-"}</dd>
            <dt>先頭バイト hex</dt>
            <dd className="cd-mono cd-comment-text" title={state.lastStreamHexDump}>
              {state.lastStreamHexDump ?? "-"}
            </dd>
          </dl>

          <h4 className="cd-section-title">📝 コメント → リクエスト pipeline</h4>
          <dl className="comment-debug-list">
            <dt>コメント監視状態</dt>
            <dd className={`watcher-${state.watcherStatus}`}>
              {watcherLabel(state.watcherStatus)}
            </dd>
            <dt>コメント受信件数</dt>
            <dd>{state.receivedCount}</dd>
            <dt>最後の受信時刻</dt>
            <dd>{formatTime(state.lastReceivedAt)}</dd>
            <dt>最後のコメント</dt>
            <dd
              className="cd-comment-text"
              title={state.lastCommentText ?? ""}
            >
              {state.lastCommentText ?? "-"}
            </dd>
            <dt>投稿者</dt>
            <dd>
              {state.lastUserName
                ? `${state.lastUserName} (${state.lastUserId ?? "-"})`
                : state.lastUserId ?? "-"}
            </dd>
            <dt>動画ID抽出結果</dt>
            <dd className={`parse-${state.lastParseStatus}`}>
              {parseLabel(state.lastParseStatus)}
            </dd>
            <dt>抽出された動画ID</dt>
            <dd className="cd-mono">{state.lastVideoId ?? "-"}</dd>
            <dt>動画情報取得</dt>
            <dd className={`fetch-${state.lastVideoInfoStatus}`}>
              {fetchLabel(state.lastVideoInfoStatus)}
            </dd>
            <dt>リクエスト登録</dt>
            <dd className={`request-${state.lastRequestStatus}`}>
              {requestLabel(state.lastRequestStatus)}
            </dd>
            <dt>動画ID判定成功件数</dt>
            <dd>{state.parsedVideoIdCount}</dd>
            <dt>リクエスト登録成功件数</dt>
            <dd>{state.requestAddedCount}</dd>
            <dt>最後のエラー</dt>
            <dd className="cd-error">{state.lastError ?? "-"}</dd>
          </dl>

          {showLog ? (
            <>
              <h4 className="cd-section-title">
                🕒 イベントログ (新しい順, 最新{state.events.length}/60件)
              </h4>
              <EventLog events={state.events} />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
