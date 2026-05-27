import { useState } from "react";
import type { CommentSettings } from "../../shared/types";

type Props = {
  settings: CommentSettings;
  onChange: (partial: Partial<CommentSettings>) => void;
};

export default function CommentSettingsPanel({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="comment-settings-panel">
      <button
        type="button"
        className="comment-settings-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        主コメ設定 {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="comment-settings-body">
          <label className="cs-row">
            <input
              type="checkbox"
              checked={settings.autoPostVideoInfoOnPlay}
              onChange={(e) =>
                onChange({ autoPostVideoInfoOnPlay: e.target.checked })
              }
            />
            再生開始時に動画情報を自動投稿する
          </label>
          <label className="cs-row">
            投稿ディレイ (ms):
            <input
              type="number"
              min={0}
              max={10000}
              step={100}
              value={settings.postDelayMs}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0) {
                  onChange({ postDelayMs: n });
                }
              }}
            />
          </label>
          <label className="cs-row">
            command:
            <input
              type="text"
              value={settings.defaultCommand}
              placeholder="(例: yellow medium)"
              onChange={(e) => onChange({ defaultCommand: e.target.value })}
            />
          </label>
          <label className="cs-row">
            name (任意):
            <input
              type="text"
              value={settings.defaultName}
              onChange={(e) => onChange({ defaultName: e.target.value })}
            />
          </label>
          <label className="cs-row">
            <input
              type="checkbox"
              checked={settings.defaultIsPermanent}
              onChange={(e) =>
                onChange({ defaultIsPermanent: e.target.checked })
              }
            />
            固定コメント (isPermanent)
          </label>
          <label className="cs-row cs-template">
            テンプレート:
            <textarea
              value={settings.template}
              onChange={(e) => onChange({ template: e.target.value })}
              rows={2}
            />
          </label>
          <div className="cs-hint">
            使用可能変数:{" "}
            {"{title} {displayAuthorName} {ownerName} {videoId} {url} {viewCount} {commentCount} {mylistCount} {duration} {requestUserName} {requestCommentNo}"}
          </div>
        </div>
      ) : null}
    </section>
  );
}
