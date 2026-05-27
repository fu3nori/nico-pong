import type {
  CommentConnectionStatus,
  RequestAcceptanceSettings,
} from "../../shared/types";

type Props = {
  status: CommentConnectionStatus;
  error: string | null;
  recvCount: number;
  acceptance: RequestAcceptanceSettings;
  onAcceptanceChange: (partial: Partial<RequestAcceptanceSettings>) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

function statusLabel(status: CommentConnectionStatus, recvCount: number): string {
  switch (status) {
    case "connected":
      // 受信実績がある時は "受信中"、まだなら "接続済"
      return recvCount > 0 ? `受信中 (${recvCount}件)` : "接続済";
    case "connecting":
      return "接続中…";
    case "error":
      return "エラー";
    case "disconnected":
    default:
      return "未接続";
  }
}

export default function CommentConnectionPanel({
  status,
  error,
  recvCount,
  acceptance,
  onAcceptanceChange,
  onConnect,
  onDisconnect,
}: Props) {
  const connected = status === "connected" || status === "connecting";
  return (
    <section className="comment-conn">
      <div className="conn-header">
        <span className="label">コメント接続:</span>
        <span className={`status-badge conn-${status}`}>
          {statusLabel(status, recvCount)}
        </span>
        {connected ? (
          <button type="button" onClick={onDisconnect}>
            停止
          </button>
        ) : (
          <button type="button" onClick={onConnect}>
            接続開始
          </button>
        )}
      </div>
      <div className="conn-options">
        <label>
          <input
            type="checkbox"
            checked={acceptance.requestAcceptMode === "accept"}
            onChange={(e) =>
              onAcceptanceChange({
                requestAcceptMode: e.target.checked ? "accept" : "stop",
              })
            }
          />
          リクエスト受付
        </label>
        <label>
          1人あたり最大:
          <input
            type="number"
            min={1}
            max={50}
            value={acceptance.maxRequestsPerUser}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) {
                onAcceptanceChange({ maxRequestsPerUser: n });
              }
            }}
            style={{ width: 50, marginLeft: 4 }}
          />
        </label>
      </div>
      {error ? <div className="conn-error">{error}</div> : null}
    </section>
  );
}
