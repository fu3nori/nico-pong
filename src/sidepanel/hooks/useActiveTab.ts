import { useCallback, useEffect, useState } from "react";
import type { NicoPongTab } from "../../shared/types";
import { getActiveTab, setActiveTab } from "../../storage/settingsRepository";

export function useActiveTab() {
  const [tab, setTabState] = useState<NicoPongTab>("request");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getActiveTab().then((t) => {
      setTabState(t);
      setReady(true);
    });
  }, []);

  const setTab = useCallback((next: NicoPongTab) => {
    setTabState(next);
    void setActiveTab(next);
  }, []);

  return { tab, setTab, ready };
}
