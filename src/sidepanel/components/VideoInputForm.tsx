import { useState } from "react";
import { extractNicoVideoId } from "../../shared/nicoVideoId";
import { fetchNicoVideoInfo } from "../../shared/nicoVideoApi";
import type { NicoPongTab, NicoPongVideoDraft } from "../../shared/types";

type Props = {
  activeTab: NicoPongTab;
  onAdd: (tab: NicoPongTab, draft: NicoPongVideoDraft) => Promise<void>;
  notify: (msg: string, level: "info" | "error" | "success") => void;
};

export default function VideoInputForm({ activeTab, onAdd, notify }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const targetLabel = activeTab === "request" ? "リクエスト" : "ストック";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);

    const trimmed = input.trim();
    if (!trimmed) {
      setLocalError("動画ID または URL を入力してください");
      return;
    }
    const videoId = extractNicoVideoId(trimmed);
    if (!videoId) {
      setLocalError("動画IDが認識できません (sm/nm/so から始まるIDが必要)");
      return;
    }

    setBusy(true);
    try {
      const result = await fetchNicoVideoInfo(videoId);
      if (!result.ok) {
        setLocalError(`動画情報の取得に失敗: ${result.errorMessage}`);
        return;
      }
      try {
        await onAdd(activeTab, result.video);
        notify(`${videoId} を${targetLabel}に追加しました`, "success");
        setInput("");
      } catch (err) {
        if (err instanceof Error && err.message === "DUPLICATE_VIDEO") {
          setLocalError(`この動画は既に${targetLabel}に追加されています。`);
        } else {
          setLocalError(
            err instanceof Error ? `保存失敗: ${err.message}` : "保存に失敗しました"
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="input-form" onSubmit={handleSubmit}>
      <div className="input-form-label">動画IDまたはURL入力</div>
      <div className="row">
        <input
          type="text"
          placeholder="動画ID / URL (例: sm12345678)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          aria-label="動画ID または URL"
        />
        <button type="submit" disabled={busy}>
          {busy ? "取得中..." : "追加"}
        </button>
      </div>
      <div className="hint">追加先: 現在のタブ ({targetLabel})</div>
      {localError ? <div className="error">{localError}</div> : null}
    </form>
  );
}
