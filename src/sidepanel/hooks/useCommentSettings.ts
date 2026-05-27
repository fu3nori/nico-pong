import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_COMMENT_SETTINGS,
  type CommentSettings,
} from "../../shared/types";
import {
  getCommentSettings,
  setCommentSettings as persistCommentSettings,
} from "../../storage/settingsRepository";

export function useCommentSettings() {
  const [settings, setSettingsState] = useState<CommentSettings>(
    DEFAULT_COMMENT_SETTINGS
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getCommentSettings().then((s) => {
      setSettingsState(s);
      setReady(true);
    });
  }, []);

  const update = useCallback(
    (partial: Partial<CommentSettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...partial };
        void persistCommentSettings(next);
        return next;
      });
    },
    []
  );

  return { settings, update, ready };
}
