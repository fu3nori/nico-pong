import { useCallback, useEffect, useState } from "react";
import type { ProgramInfo } from "../../shared/types";
import { MSG_GET_PROGRAM_INFO } from "../../shared/messaging";

type State = {
  info: ProgramInfo | null;
  loading: boolean;
};

export function useProgramInfo() {
  const [state, setState] = useState<State>({ info: null, loading: true });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];
      if (!tab || typeof tab.id !== "number") {
        setState({
          info: {
            status: "unknown",
            detectedAt: new Date().toISOString(),
            errorMessage: "アクティブなタブが取得できません",
          },
          loading: false,
        });
        return;
      }
      const url = tab.url ?? "";
      if (!/^https:\/\/live\.nicovideo\.jp\/watch\/lv\d+/.test(url)) {
        setState({
          info: {
            status: "not_nicolive_page",
            url,
            detectedAt: new Date().toISOString(),
          },
          loading: false,
        });
        return;
      }

      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: MSG_GET_PROGRAM_INFO,
        });
        if (res && typeof res === "object" && res.type === "PROGRAM_INFO_RESULT") {
          setState({ info: res.payload as ProgramInfo, loading: false });
        } else {
          setState({
            info: {
              status: "unknown",
              url,
              detectedAt: new Date().toISOString(),
              errorMessage: "Content Scriptから情報が取得できませんでした",
            },
            loading: false,
          });
        }
      } catch (e) {
        setState({
          info: {
            status: "error",
            url,
            detectedAt: new Date().toISOString(),
            errorMessage:
              e instanceof Error ? e.message : "Content Script未注入の可能性",
          },
          loading: false,
        });
      }
    } catch (e) {
      setState({
        info: {
          status: "error",
          detectedAt: new Date().toISOString(),
          errorMessage: e instanceof Error ? e.message : String(e),
        },
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onActivated = () => refresh();
    const onUpdated = (
      _tabId: number,
      change: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && (change.status === "complete" || change.url)) {
        refresh();
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh]);

  return { ...state, refresh };
}
