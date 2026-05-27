import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_REQUEST_ACCEPTANCE_SETTINGS,
  type RequestAcceptanceSettings,
} from "../../shared/types";
import {
  getRequestAcceptanceSettings,
  setRequestAcceptanceSettings as persist,
} from "../../storage/settingsRepository";

export function useRequestAcceptance() {
  const [settings, setSettings] = useState<RequestAcceptanceSettings>(
    DEFAULT_REQUEST_ACCEPTANCE_SETTINGS
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getRequestAcceptanceSettings().then((s) => {
      setSettings({ ...s, autoAcceptCommentRequests: true, preventDuplicateInRequest: true });
      setReady(true);
    });
  }, []);

  const update = useCallback(
    (partial: Partial<RequestAcceptanceSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...partial, autoAcceptCommentRequests: true, preventDuplicateInRequest: true };
        void persist(next);
        return next;
      });
    },
    []
  );

  return { settings, update, ready };
}
