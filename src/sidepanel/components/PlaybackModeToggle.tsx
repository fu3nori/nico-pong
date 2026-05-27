import type { PlaybackMode } from "../../shared/types";

type Props = {
  mode: PlaybackMode;
  onChange: (mode: PlaybackMode) => void;
};

export default function PlaybackModeToggle({ mode, onChange }: Props) {
  return (
    <div className="playback-mode" role="radiogroup" aria-label="再生モード">
      <span className="label">再生モード:</span>
      <label className={mode === "manual" ? "active" : ""}>
        <input
          type="radio"
          name="playback-mode"
          value="manual"
          checked={mode === "manual"}
          onChange={() => onChange("manual")}
        />
        手動
      </label>
      <label className={mode === "auto" ? "active" : ""}>
        <input
          type="radio"
          name="playback-mode"
          value="auto"
          checked={mode === "auto"}
          onChange={() => onChange("auto")}
        />
        自動 (リクエスト)
      </label>
    </div>
  );
}
