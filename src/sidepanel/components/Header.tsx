import type { ProgramInfo } from "../../shared/types";

type Props = {
  info: ProgramInfo | null;
  loading: boolean;
  onRefresh: () => void;
};

function statusLabel(status: ProgramInfo["status"] | undefined): string {
  switch (status) {
    case "detected":
      return "番組検出";
    case "not_nicolive_page":
      return "ニコ生ページではありません";
    case "error":
      return "取得エラー";
    case "unknown":
      return "状態不明";
    default:
      return "-";
  }
}

export default function Header({ info, loading, onRefresh }: Props) {
  const status = info?.status;
  return (
    <header className="header">
      <h1>nico pong</h1>
      <div className="meta">
        <span className="label">番組:</span>
        <span>{info?.title ?? (loading ? "取得中..." : "-")}</span>
        <span className="label">lvID:</span>
        <span>{info?.lvId ?? "-"}</span>
        <span className="label">状態:</span>
        <span>
          <span className={`status-badge ${status ?? ""}`}>
            {statusLabel(status)}
          </span>
          {info?.errorMessage ? `  ${info.errorMessage}` : ""}
          {" "}
          <button
            type="button"
            onClick={onRefresh}
            style={{
              marginLeft: 6,
              fontSize: 11,
              padding: "1px 6px",
              cursor: "pointer",
            }}
            title="番組情報を再取得"
          >
            再取得
          </button>
        </span>
      </div>
    </header>
  );
}
