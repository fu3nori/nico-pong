import type {
  RequestAcceptanceSettings,
} from "../../shared/types";

type CommentConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

type Props = {
  status: CommentConnectionStatus;
  error: string | null;
  recvCount: number;
  acceptance: RequestAcceptanceSettings;
  onAcceptanceChange: (partial: Partial<RequestAcceptanceSettings>) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

export default function CommentConnectionPanel({
  status,
  error: _error,
  recvCount: _recvCount,
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
    </section>
  );
}
