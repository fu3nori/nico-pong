import { useState } from "react";
import { extractNicoMylistIdAllowBareNumber } from "../../shared/nicoIdExtract";
import type { NicoPongTab } from "../../shared/types";
import type { MylistImportProgress } from "../hooks/useMylistImport";

type Props = {
  activeTab: NicoPongTab;
  progress: MylistImportProgress;
  onImport: (mylistId: string, target: NicoPongTab) => Promise<void>;
};

export default function MylistImportForm({
  activeTab,
  progress,
  onImport,
}: Props) {
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const busy = progress.running;
  const targetLabel = activeTab === "request" ? "リクエスト" : "ストック";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setLocalError("マイリストID または URL を入力してください");
      return;
    }
    const mylistId = extractNicoMylistIdAllowBareNumber(trimmed);
    if (!mylistId) {
      setLocalError(
        "マイリストIDが認識できません (例: mylist/12345 / https://www.nicovideo.jp/mylist/12345)"
      );
      return;
    }
    await onImport(mylistId, activeTab);
    setInput("");
  }

  return (
    <section className="mylist-import">
      <button
        type="button"
        className="mylist-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        マイリスト一括追加 {open ? "▲" : "▼"}
      </button>
      {open ? (
        <form className="mylist-form" onSubmit={handleSubmit}>
          <div className="row">
            <input
              type="text"
              placeholder="mylist/12345 / https://www.nicovideo.jp/mylist/12345"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              aria-label="マイリストID または URL"
            />
            <button type="submit" disabled={busy}>
              {busy ? "取得中..." : `${targetLabel}へ一括追加`}
            </button>
          </div>
          <div className="hint">追加先: 現在のタブ ({targetLabel})</div>
          {localError ? <div className="error">{localError}</div> : null}
          {progress.total > 0 || progress.running ? (
            <div className="progress">
              {progress.mylistId ? `mylist/${progress.mylistId}: ` : ""}
              読み込み {progress.done}/{progress.total} / 追加:{progress.imported}
              {" / 重複:"}{progress.duplicated}
              {" / 失敗:"}{progress.failed}
              {progress.lastError ? (
                <div className="error">{progress.lastError}</div>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
