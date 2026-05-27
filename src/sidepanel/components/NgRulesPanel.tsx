import { useState } from "react";
import type { NgRuleSet } from "../../shared/types";

type Props = {
  rules: NgRuleSet;
  onChange: (next: NgRuleSet) => void;
};

type Key = keyof NgRuleSet;

const LABELS: Record<Key, string> = {
  videoIds: "NG動画ID (1行1件)",
  ownerIds: "NG投稿者ID (1行1件)",
  userIds: "NGリク主userId (1行1件)",
  titleWords: "NGタイトル語 (1行1件)",
  tagWords: "NGタグ (1行1件)",
  descriptionWords: "NG説明文語 (1行1件)",
};

function arrToText(arr: string[]): string {
  return arr.join("\n");
}

function textToArr(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function NgRulesPanel({ rules, onChange }: Props) {
  const [open, setOpen] = useState(false);

  function handleFieldChange(key: Key, value: string) {
    onChange({ ...rules, [key]: textToArr(value) });
  }

  return (
    <section className="ng-rules-panel">
      <button
        type="button"
        className="ng-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        NG設定 {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div className="ng-body">
          {(Object.keys(LABELS) as Key[]).map((key) => (
            <label key={key} className="ng-field">
              <span>{LABELS[key]}</span>
              <textarea
                value={arrToText(rules[key])}
                onChange={(e) => handleFieldChange(key, e.target.value)}
                rows={2}
              />
            </label>
          ))}
          <div className="ng-hint">
            ※ NG動画ID/投稿者ID/タイトル語/タグに一致する動画は自動再生でスキップされます。
          </div>
        </div>
      ) : null}
    </section>
  );
}
